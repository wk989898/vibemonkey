import initCache from "@/common/cache";
import { addOwnCommands } from "./init";

const cache = initCache<unknown>({
  lifetime: 5 * 60 * 1000,
});

addOwnCommands({
  CacheLoad(key: string) {
    return cache.get(key) ?? null;
  },
  CacheHit(data: { key: string; lifetime?: number }) {
    cache.hit(data.key, data.lifetime);
  },
  CachePop(key) {
    return cache.pop(key) ?? null;
  },
});

export default cache;
