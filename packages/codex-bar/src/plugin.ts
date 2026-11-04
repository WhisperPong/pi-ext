import type { ExtensionAPI, ExtensionContext, MessageEndEvent, MessageUpdateEvent, ProviderStreamEvent } from "@earendil-works/pi-coding-agent";
import { FastMode } from "./fast-mode.ts";
import { OutputSpeed } from "./output-speed.ts";
import { renderStatus, type UsageState } from "./status-view.ts";
import { CodexUsageClient, isCodexModel } from "./usage-client.ts";

export class CodexBarPlugin {
  private readonly pi: ExtensionAPI;
  private readonly client = new CodexUsageClient();
  private readonly fast = new FastMode();
  private readonly speed = new OutputSpeed();
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
    this.pi.on("message_update", (event, ctx) => this.observeText(event, ctx));
    this.pi.on("message_end", (event, ctx) => this.finishRequest(event, ctx));
    this.pi.on("session_shutdown", (_event, ctx) => {
      this.pending?.abort();
      this.speed.reset();
      renderStatus(ctx);
    });
  }

  private startSession(ctx: ExtensionContext): Promise<void> {
    this.fast.reset();
    this.speed.reset();
    return this.refresh(ctx);
  }

  private selectModel(ctx: ExtensionContext): Promise<void> {
    this.fast.resetObservation();
    this.speed.reset();
    return this.refresh(ctx);
  }

  private render(ctx: ExtensionContext): void {
    renderStatus(ctx, isCodexModel(ctx.model)
      ? { usage: this.usage, fast: this.fast.label, speed: this.speed.label }
      : undefined);
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
    if (replacement) this.speed.start();
    this.render(ctx);
    return replacement;
  }

  private observeText(event: MessageUpdateEvent, ctx: ExtensionContext): void {
    const message = event.message;
    const delta = event.assistantMessageEvent;
    if (!isCodexModel(ctx.model) || message.role !== "assistant"
      || message.provider !== ctx.model?.provider || message.model !== ctx.model.id || delta.type !== "text_delta") return;
    this.speed.recordTextDelta(delta.contentIndex, delta.delta);
  }

  private finishRequest(event: MessageEndEvent, ctx: ExtensionContext): void {
    const message = event.message;
    if (!isCodexModel(ctx.model) || message.role !== "assistant"
      || message.provider !== ctx.model?.provider || message.model !== ctx.model.id) return;
    const previous = this.speed.label;
    const valid = message.stopReason !== "error" && message.stopReason !== "aborted"
      && message.stopReason !== "toolUse" && !message.content.some((part) => part.type === "toolCall");
    this.speed.finish(valid ? message.usage.output : undefined, message.usage.reasoning);
    if (this.speed.label !== previous) this.render(ctx);
  }

  private observeResponse(event: ProviderStreamEvent, ctx: ExtensionContext): void {
    if (!isCodexModel(ctx.model) || event.provider !== ctx.model?.provider || event.model !== ctx.model.id) return;
    const previous = this.fast.label;
    this.fast.observe(event.data);
    if (this.fast.label !== previous) this.render(ctx);
  }
}
