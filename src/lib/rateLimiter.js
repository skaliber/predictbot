/**
 * Token bucket pentru API-ul PredictCamp (120 cereri/minut pe endpoint-urile
 * de date). Ținem o marjă sub limită, fiindcă fereastra serverului nu e
 * aliniată cu a noastră.
 */
export class RateLimiter {
  constructor({ maxRequests = 100, windowMs = 60_000 } = {}) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.timestamps = [];
    /** Setat când serverul ne-a spus explicit să așteptăm (429). */
    this.blockedUntil = 0;
  }

  /** Așteaptă până când e liber un slot. */
  async acquire() {
    for (;;) {
      const now = Date.now();
      if (now < this.blockedUntil) {
        await sleep(this.blockedUntil - now);
        continue;
      }
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now);
        return;
      }
      const oldest = this.timestamps[0];
      await sleep(Math.max(50, this.windowMs - (now - oldest)));
    }
  }

  /** Apelat la 429: blochează emiterea până expiră fereastra serverului. */
  blockFor(ms) {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + Math.max(0, ms));
  }

  get pending() {
    const now = Date.now();
    return this.timestamps.filter((t) => now - t < this.windowMs).length;
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default RateLimiter;
