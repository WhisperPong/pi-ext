export class OutputSpeed {
  private startedAt?: number;
  private tokensPerSecond?: number;

  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  get label(): string {
    if (this.startedAt !== undefined) return "...";
    return this.tokensPerSecond === undefined ? "--" : `${this.tokensPerSecond.toFixed(1)} tok/s`;
  }

  reset(): void {
    this.startedAt = undefined;
    this.tokensPerSecond = undefined;
  }

  start(): void {
    this.reset();
    this.startedAt = this.now();
  }

  finish(outputTokens?: number): void {
    if (this.startedAt === undefined) return;
    const elapsed = this.now() - this.startedAt;
    this.reset();
    if (outputTokens === undefined || !Number.isFinite(outputTokens) || outputTokens < 0 || elapsed <= 0) return;
    const speed = outputTokens * 1000 / elapsed;
    if (Number.isFinite(speed)) this.tokensPerSecond = speed;
  }
}
