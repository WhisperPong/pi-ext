interface TextSample {
  first: number;
  last: number;
  chunks: number;
}

export class OutputSpeed {
  private active = false;
  private readonly text = new Map<number, TextSample>();
  private tokensPerSecond?: number;
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  get label(): string {
    return this.tokensPerSecond === undefined ? "--" : `${this.tokensPerSecond.toFixed(1)} tok/s`;
  }

  reset(): void {
    this.active = false;
    this.text.clear();
    this.tokensPerSecond = undefined;
  }

  start(): void {
    this.active = true;
    this.text.clear();
    // Keep the last valid result visible during waiting, reasoning, and tool calls.
  }

  recordTextDelta(contentIndex: number, delta: string): void {
    if (!this.active || !delta) return;
    const now = this.now();
    const sample = this.text.get(contentIndex);
    if (sample) {
      sample.last = now;
      sample.chunks++;
    } else {
      this.text.set(contentIndex, { first: now, last: now, chunks: 1 });
    }
  }

  finish(outputTokens?: number, reasoningTokens = 0): void {
    if (!this.active) return;
    this.active = false;
    const samples = [...this.text.values()];
    this.text.clear();
    if (outputTokens === undefined || !Number.isFinite(outputTokens)
      || !Number.isFinite(reasoningTokens) || reasoningTokens < 0 || outputTokens <= reasoningTokens) return;
    // A single buffered chunk has no measurable generation interval. Likewise,
    // very short samples amplify network buffering and timing errors.
    if (!samples.length || samples.some((sample) => sample.chunks < 2 || sample.last <= sample.first)) return;
    const elapsed = samples.reduce((total, sample) => total + sample.last - sample.first, 0);
    if (elapsed < 500) return;
    // Only time visible text streaming; exclude prefill, reasoning, inter-block
    // gaps, and final usage delivery. This remains a client-observed estimate.
    const speed = (outputTokens - reasoningTokens) * 1000 / elapsed;
    if (Number.isFinite(speed)) this.tokensPerSecond = speed;
  }
}
