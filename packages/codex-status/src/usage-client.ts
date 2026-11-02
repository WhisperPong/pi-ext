import { Buffer } from "node:buffer";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface UsageWindow {
  seconds: number;
  remaining: number;
}

interface UsageResponse {
  rate_limit?: {
    primary_window?: { used_percent?: number; limit_window_seconds?: number };
    secondary_window?: { used_percent?: number; limit_window_seconds?: number };
  };
}

export function isCodexModel(model: ExtensionContext["model"]): boolean {
  return model?.provider === "openai-codex" || model?.api === "openai-codex-responses";
}

export class CodexUsageClient {
  async fetch(ctx: ExtensionContext, signal: AbortSignal): Promise<UsageWindow[]> {
    if (!ctx.model) throw new Error("Missing model");
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    signal.throwIfAborted();
    if (!auth.ok || !auth.apiKey) throw new Error("Missing authentication");

    const claims = JSON.parse(Buffer.from(auth.apiKey.split(".")[1] ?? "", "base64url").toString());
    const accountId = Object.entries(auth.headers ?? {})
      .find(([key]) => key.toLowerCase() === "chatgpt-account-id")?.[1]
      ?? claims["https://api.openai.com/auth"]?.chatgpt_account_id;
    if (typeof accountId !== "string" || !accountId) throw new Error("Missing account");

    const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
      headers: { Authorization: `Bearer ${auth.apiKey}`, "ChatGPT-Account-Id": accountId },
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      redirect: "error",
    });
    if (!response.ok) throw new Error("Usage unavailable");

    const data = await response.json() as UsageResponse;
    const windows: UsageWindow[] = [];
    for (const window of [data.rate_limit?.primary_window, data.rate_limit?.secondary_window]) {
      const used = window?.used_percent;
      const seconds = window?.limit_window_seconds;
      if (typeof used !== "number" || !Number.isFinite(used)) continue;
      if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) continue;
      windows.push({ seconds, remaining: Math.round(Math.max(0, Math.min(100, 100 - used))) });
    }
    if (!windows.length) throw new Error("Usage unavailable");
    return windows;
  }
}
