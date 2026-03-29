type CacheEntry<T> = {
  value: T;
  lifetime?: number;
  expiry?: number;
};

type CacheStore<T> = Record<string, CacheEntry<T>>;

export interface CacheOptions<T> {
  lifetime?: number;
  onDispose?: (value: T, key: string) => void;
}

export interface CacheApi<T = unknown> {
  batch(enable: boolean): void;
  get<D = undefined>(key: string, def?: D, shouldHit?: boolean): T | D | undefined;
  some(fn: (value: T, key: string) => unknown, thisObj?: unknown): boolean | undefined;
  pop<D = undefined>(key: string, def?: D): T | D | undefined;
  put(key: string, value: T, lifetime?: number): T;
  del(key: string): void;
  has(key: string): boolean;
  hit(key: string, lifetime?: number): void;
  destroy(): void;
  data?: CacheStore<T>;
}

export default function initCache<T = unknown>({
  lifetime: defaultLifetime = 3000,
  onDispose,
}: CacheOptions<T> = {}): CacheApi<T> {
  let cache: CacheStore<T> = Object.create(null);
  // setTimeout call is very expensive when done frequently,
  // 1000 calls performed for 50 scripts consume 50ms on each tab load,
  // so we'll schedule trim() just once per event loop cycle,
  // and then trim() will trim the cache and reschedule itself to the earliest expiry time.
  let timer: ReturnType<typeof setTimeout> | 0 | undefined;
  let minLifetime = -1;
  // same goes for the performance.now() used by hit() and put() which is why we expose batch(true)
  // to start an operation that reuses the same value of now(), and batch(false) to end it
  let batchStarted = false;
  let batchStartTime;
  const getNow = () => (batchStarted && batchStartTime) || (batchStartTime = performance.now());
  const OVERRUN = 1000; // in ms, to reduce frequency of calling setTimeout
  const exports: CacheApi<T> = {
    batch,
    get,
    some,
    pop,
    put,
    del,
    has,
    hit,
    destroy,
  };
  if (process.env.DEV) Object.defineProperty(exports, "data", { get: () => cache });
  return exports;
  function batch(enable: boolean) {
    batchStarted = enable;
    batchStartTime = 0;
  }
  function get<D = undefined>(key: string, def?: D, shouldHit = true) {
    const item = cache[key];
    if (item && shouldHit) {
      reschedule(item, item.lifetime);
    }
    return item ? item.value : def;
  }
  function some(fn: (value: T, key: string) => unknown, thisObj?: unknown) {
    for (const key in cache) {
      const item = cache[key];
      // Might be already deleted by fn
      if (item && fn.call(thisObj, item.value, key)) {
        return true;
      }
    }
  }
  function pop<D = undefined>(key: string, def?: D) {
    const value = get(key, def);
    del(key);
    return value;
  }
  function put(key: string, value: T, lifetime?: number) {
    reschedule((cache[key] = lifetime ? { value, lifetime } : { value }), lifetime);
    return value;
  }
  function del(key: string) {
    const data = cache[key];
    if (data) {
      delete cache[key];
      onDispose?.(data.value, key);
    }
  }
  function has(key: string) {
    return key in cache;
  }
  function hit(key: string, lifetime?: number) {
    const entry = cache[key];
    if (entry) {
      reschedule(entry, lifetime);
    }
  }
  function destroy() {
    // delete all keys to make sure onDispose is called for each value
    if (onDispose) {
      // cache inherits null so we don't need to check hasOwnProperty
      for (const key in cache) {
        del(key);
      }
    } else {
      cache = Object.create(null);
    }
    clearTimeout(timer);
    timer = 0;
  }
  function reschedule(entry: CacheEntry<T>, lifetime = defaultLifetime) {
    entry.expiry = lifetime + getNow();
    if (timer) {
      if (lifetime >= minLifetime) return;
      clearTimeout(timer);
    }
    minLifetime = lifetime;
    timer = setTimeout(trim, lifetime + OVERRUN);
  }
  function trim() {
    const now = performance.now();
    let closestExpiry = Number.MAX_SAFE_INTEGER;
    for (const key in cache) {
      const { expiry = Number.MAX_SAFE_INTEGER } = cache[key];
      if (expiry < now) {
        del(key);
      } else if (expiry < closestExpiry) {
        closestExpiry = expiry;
      }
    }
    minLifetime = closestExpiry - now;
    timer = closestExpiry < Number.MAX_SAFE_INTEGER ? setTimeout(trim, minLifetime + OVERRUN) : 0;
  }
}
