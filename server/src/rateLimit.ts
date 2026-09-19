// Token-bucket limiter with abuse detection. One instance per connection per
// limited message kind. Time is passed in (ms) so it is trivially testable.

export type LimitResult = "ok" | "limited" | "abuse";

export class Limiter {
  private tokens: number;
  private last = -1;
  private windowStart = 0;
  private dropped = 0;

  /**
   * @param ratePerSec    sustained allowed messages per second
   * @param burst         bucket size (short bursts above the sustained rate)
   * @param abuseFactor   dropping more than ratePerSec × abuseFactor messages
   *                      within one second is reported as "abuse"
   */
  constructor(
    private readonly ratePerSec: number,
    private readonly burst: number,
    private readonly abuseFactor: number,
  ) {
    this.tokens = burst;
  }

  take(nowMs: number): LimitResult {
    if (this.last < 0) this.last = nowMs;
    this.tokens = Math.min(this.burst, this.tokens + ((nowMs - this.last) / 1000) * this.ratePerSec);
    this.last = nowMs;

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return "ok";
    }

    if (nowMs - this.windowStart >= 1000) {
      this.windowStart = nowMs;
      this.dropped = 0;
    }
    this.dropped += 1;
    return this.dropped > this.ratePerSec * this.abuseFactor ? "abuse" : "limited";
  }
}
