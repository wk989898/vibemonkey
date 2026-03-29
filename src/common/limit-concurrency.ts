import { makePause } from "@/common/index";

/**
 * @param {function} fn
 * @param {number} max
 * @param {number} diffKeyDelay
 * @param {number} sameKeyDelay
 * @param {function(...args: any[]): string} getKey
 * @return {function(...args: any[]): Promise}
 */
function limitConcurrency<TArgs extends any[], TResult>(
  fn: (...args: TArgs) => Promise<TResult> | TResult,
  max: number,
  diffKeyDelay: number,
  sameKeyDelay: number,
  getKey: (...args: TArgs) => string,
) {
  const keyPromise: Record<string, Promise<void>> = {};
  const keyTime: Record<string, number> = {};
  const pool = new Set<Promise<void>>();
  const maxDelay = Math.max(diffKeyDelay, sameKeyDelay);
  let lastTime = 0;
  let lastKey = "";
  return async function limiter(...args: TArgs) {
    let resolve!: () => void;
    let t = 0;
    const key = getKey(...args);
    const old = keyPromise[key];
    const promise = (keyPromise[key] = new Promise<void>((cb) => {
      resolve = cb;
    }).catch(console.warn));
    if (old) await old;
    // Looping because the oldest awaiting instance will immediately add to `pool`
    while (pool.size === max) await Promise.race(pool);
    pool.add(promise);
    if (key === lastKey) {
      t = keyTime[key];
      t = maxDelay - (t ? performance.now() - t : 0);
    } else if (lastTime) {
      t = diffKeyDelay - (performance.now() - lastTime);
    }
    if (t > 0) await makePause(t);
    try {
      lastKey = key;
      return await fn(...args);
    } finally {
      pool.delete(promise);
      if (keyPromise[key] === promise) delete keyPromise[key];
      lastTime = keyTime[key] = performance.now();
      resolve();
    }
  };
}

export default limitConcurrency;
