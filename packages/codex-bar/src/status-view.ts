import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { UsageWindow } from "./usage-client.ts";

export type UsageState =
  | { kind: "loading" | "unavailable" }
  | { kind: "ready"; windows: UsageWindow[] };

interface Status {
  usage: UsageState;
  fast: string;
}

function formatWindow({ seconds, remaining }: UsageWindow): string {
  const period = seconds % 86400 === 0 ? `${seconds / 86400}d`
    : seconds % 3600 === 0 ? `${seconds / 3600}h` : `${Math.round(seconds / 60)}m`;
  return `${period}: ${remaining}% left`;
}

export function renderStatus(ctx: ExtensionContext, status?: Status): void {
  if (!ctx.hasUI) return;
  if (!status) {
    ctx.ui.setWidget("codex-bar", undefined);
    return;
  }
  const usage = status.usage.kind === "ready"
    ? status.usage.windows.map(formatWindow).join(" | ")
    : `Usage: ${status.usage.kind}`;
  ctx.ui.setWidget("codex-bar", [
    `Codex | ${usage} | Effort: ${ctx.thinkingLevel ?? "unknown"} | Fast: ${status.fast}`,
  ], { placement: "belowEditor" });
}
