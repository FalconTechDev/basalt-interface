// Timing helpers of the plugin API (`debounce`).

/**
 * Wraps `fn` so that a burst of calls results in ONE call `wait` ms after the first call of the burst (or, with `resetTimer`,
 * `wait` ms after the LAST call). The last arguments and receiver win. The returned function also has `cancel()` and `run()`
 * (run the pending call right now). The timer lives in whichever window is active, so a pop-out window keeps working.
 */
export function debounceCall(fn, wait = 0, resetTimer = false) {
  let timer = null;          // pending timeout id, or null
  let timerWindow = activeWindow;
  let pendingThis = null;
  let pendingArgs = null;
  let notBefore = 0;         // postponed deadline set by a "reset" call while the timer was running
  let firstDeadline = 0;     // when the pending call is due

  const invoke = () => {
    const self = pendingThis;
    const args = pendingArgs;
    pendingThis = null;
    pendingArgs = null;
    return fn.apply(self, args);
  };

  const onTimer = () => {
    if (notBefore) {
      const now = Date.now();
      if (now < notBefore) {
        // a later call asked to push the deadline back: sleep the remaining time
        timerWindow = activeWindow;
        timer = timerWindow.setTimeout(onTimer, notBefore - now);
        notBefore = 0;
        return;
      }
    }
    firstDeadline = 0;
    timer = null;
    invoke();
  };

  const debounced = function (...args) {
    pendingThis = this;
    pendingArgs = args;
    const now = Date.now();
    if (timer) {
      if (resetTimer) {
        notBefore = firstDeadline = now + wait;
      } else if (timerWindow !== activeWindow && firstDeadline <= now) {
        // the window that owns the timer may be hidden/throttled: restart it in the window being used now
        timerWindow.clearTimeout(timer);
        timerWindow = activeWindow;
        timer = timerWindow.setTimeout(onTimer, 0);
      }
    } else {
      timerWindow = activeWindow;
      firstDeadline = now + wait;
      timer = timerWindow.setTimeout(onTimer, wait);
    }
    return debounced;
  };

  debounced.cancel = () => {
    if (timer) {
      timerWindow.clearTimeout(timer);
      timer = null;
    }
    return debounced;
  };

  debounced.run = () => {
    if (!timer) return undefined;
    timerWindow.clearTimeout(timer);
    timer = null;
    return invoke();
  };

  return debounced;
}
