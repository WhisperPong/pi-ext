type Mode = "on" | "off";

function readTier(tier: unknown): Mode | undefined {
  if (tier === "priority" || tier === "fast") return "on";
  if (tier === "default" || tier === "flex") return "off";
}

export class FastMode {
  private preference?: Mode;
  private requested?: Mode;
  private served?: Mode;

  get label(): string {
    if (this.preference && this.preference !== this.requested) return `${this.preference} (next request)`;
    if (this.served && this.requested && this.served !== this.requested) {
      return `${this.requested} (server: ${this.served})`;
    }
    return this.served ?? (this.requested ? `${this.requested} (requested)` : "unknown");
  }

  set(mode: Mode): void {
    this.preference = mode;
  }

  toggle(): void {
    this.set((this.preference ?? this.requested ?? this.served) === "on" ? "off" : "on");
  }

  reset(): void {
    this.preference = undefined;
    this.resetObservation();
  }

  resetObservation(): void {
    this.requested = undefined;
    this.served = undefined;
  }

  prepare(payload: unknown): Record<string, unknown> | undefined {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
    const original = payload as Record<string, unknown>;
    const replacement = this.preference
      ? { ...original, service_tier: this.preference === "on" ? "priority" : "default" }
      : undefined;
    this.requested = readTier((replacement ?? original).service_tier);
    this.served = undefined;
    return replacement;
  }

  observe(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const response = (data as { response?: { service_tier?: unknown } }).response;
    const served = readTier(response?.service_tier);
    if (served) this.served = served;
  }
}
