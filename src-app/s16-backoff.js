// s16 slice: exponential backoff with jitter — used by the sync socket retry loop.

/** Z9: delays grow as base * 2^(failures-1), optionally jittered, clamped to [min, max]. */
export function defineBackoff() {
  function Backoff(min, max, base, jitter) {
    this.min = min || 0;
    this.max = max === undefined ? Number.MAX_VALUE : max;
    this.base = base || 1000;
    this.jitter = jitter === undefined ? true : jitter;
    this.count = 0;
    this.nextTs = Date.now();
  }

  Backoff.prototype.success = function () {
    this.count = 0;
    this.nextTs = Date.now() + this.getTimeout();
  };

  Backoff.prototype.fail = function () {
    this.count++;
    this.nextTs = Date.now() + this.getTimeout();
  };

  Backoff.prototype.getTimeout = function () {
    if (this.count === 0) return this.min;
    let timeout = this.base * Math.pow(2, this.count - 1);
    if (this.jitter) timeout *= 0.5 + 0.5 * Math.random();
    return Math.floor(Math.min(this.max, this.min + timeout));
  };

  Backoff.prototype.getNextTs = function () {
    return this.nextTs;
  };

  Backoff.prototype.isReady = function () {
    return Date.now() > this.nextTs;
  };

  return Backoff;
}
