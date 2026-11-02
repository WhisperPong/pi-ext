import type { ExtensionAPI, ExtensionContext, ProviderStreamEvent } from "@earendil-works/pi-coding-agent";
import { FastMode } from "./fast-mode.ts";
import { renderStatus, type UsageState } from "./status-view.ts";
import { CodexUsageClient, isCodexModel } from "./usage-client.ts";

export class CodexStatusPlugin {
  private readonly pi: ExtensionAPI;
  private readonly client = new CodexUsageClient();
  private readonly fast = new FastMode();
  private usage: UsageState = { kind: "loading" };
  private pending?: AbortController;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
  }

  register(): void {
    this.pi.registerCommand("fast", {
      description: "Toggle Codex Fast mode: /fast [on|off|status]",
      getArgumentCompletions: (prefix) => ["on", "off", "status"]
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value })),
      handler: async (args, ctx) => this.handleFastCommand(args, ctx),
    });
    this.pi.on("session_start", (_event, ctx) => this.startSession(ctx));
    this.pi.on("model_select", (_event, ctx) => this.selectModel(ctx));
    this.pi.on("agent_end", (_event, ctx) => this.refresh(ctx));
    this.pi.on("thinking_level_select", (_event, ctx) => this.render(ctx));
    this.pi.on("before_provider_request", (event, ctx) => this.prepareRequest(event.payload, ctx));
    this.pi.on("provider_stream_event", (event, ctx) => this.observeResponse(event, ctx));
    this.pi.on("session_shutdown", (_event, ctx) => {
      this.pending?.abort();
      renderStatus(ctx);
    });
  }

  private startSession(ctx: ExtensionContext): Promise<void> {
    this.fast.reset();
    return this.refresh(ctx);
  }

  private selectModel(ctx: ExtensionContext): Promise<void> {
    this.fast.resetObservation();
    return this.refresh(ctx);
  }

  private render(ctx: ExtensionContext): void {
    renderStatus(ctx, isCodexModel(ctx.model) ? { usage: this.usage, fast: this.fast.label } : undefined);
  }

  private async refresh(ctx: ExtensionContext): Promise<void> {
    this.pending?.abort();
    if (!ctx.hasUI || !isCodexModel(ctx.model)) {
      this.render(ctx);
      return;
    }
    const request = this.pending = new AbortController();
    this.usage = { kind: "loading" };
    this.render(ctx);
    try {
      const windows = await this.client.fetch(ctx, request.signal);
      if (request.signal.aborted) return;
      this.usage = { kind: "ready", windows };
    } catch {
      if (request.signal.aborted) return;
      this.usage = { kind: "unavailable" };
    }
    this.render(ctx);
  }

  private handleFastCommand(args: string, ctx: ExtensionContext): void {
    if (!isCodexModel(ctx.model)) {
      ctx.ui.notify("Fast mode requires a Codex provider.", "warning");
      return;
    }
    const action = args.trim().toLowerCase();
    if (!["", "on", "off", "status"].includes(action)) {
      ctx.ui.notify("Usage: /fast [on|off|status]", "warning");
      return;
    }
    if (action === "on" || action === "off") this.fast.set(action);
    if (!action) this.fast.toggle();
    this.render(ctx);
    ctx.ui.notify(`Fast: ${this.fast.label}`, "info");
  }

  private prepareRequest(payload: unknown, ctx: ExtensionContext): unknown {
    if (!isCodexModel(ctx.model)) return;
    const replacement = this.fast.prepare(payload);
    this.render(ctx);
    return replacement;
  }

  private observeResponse(event: ProviderStreamEvent, ctx: ExtensionContext): void {
    if (!isCodexModel(ctx.model) || event.provider !== ctx.model?.provider || event.model !== ctx.model.id) return;
    this.fast.observe(event.data);
    this.render(ctx);
  }
}
