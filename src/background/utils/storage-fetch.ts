import { isCdnUrlRe, isDataUri, isRemote, makeRaw, request } from "@/common";
import { NO_CACHE } from "@/common/consts";
import storage from "./storage";
import { getUpdateInterval } from "./update";
import { requestLimited } from "./url";

type StorageFetchOptions = VMReq.OptionsMulti | "res" | undefined;

type StorageAreaLike = {
  fetch?: (url: string, options?: StorageFetchOptions) => Promise<unknown>;
  getOne?: (id: string) => Promise<unknown>;
  remove?: (id: string) => Promise<unknown>;
  setOne: (id: string, value: unknown) => Promise<unknown>;
};

type StorageFetchHandlers = {
  init?: (options?: StorageFetchOptions) => VMReq.OptionsMulti;
  transform?: (
    response: VMReq.Response,
    url: string,
    options?: StorageFetchOptions,
  ) => Promise<unknown> | unknown;
};

(storage.cache as StorageAreaLike).fetch = cacheOrFetch({
  init: (options) => ({
    ...(options === "res" ? {} : options),
    [kResponseType]: "blob",
  }),
  transform: (response) => makeRaw(response),
});

(storage.require as StorageAreaLike).fetch = cacheOrFetch({
  transform: (response, url) => {
    const data = "data" in response && typeof response.data === "string" ? response.data : "";
    return /^\s*</.test(data)
      ? Promise.reject(
          `NOT_JS: ${url} "${data
            .slice(0, 100)
            .trim()
            .replace(/\s{2,}/g, " ")}"`,
        )
      : data;
  },
});

(storage.code as StorageAreaLike).fetch = cacheOrFetch();

/** @return {VMStorageFetch} */
function cacheOrFetch(handlers: StorageFetchHandlers = {}) {
  const requests: Record<string, Promise<unknown> | undefined> = {};
  const { init, transform } = handlers;
  return function cacheOrFetchHandler(
    this: StorageAreaLike,
    ...args: [string, StorageFetchOptions?]
  ) {
    const [url] = args;
    const promise = requests[url] || (requests[url] = doFetch.call(this, ...args));
    return promise;
  };
  /** @this {VMStorageArea} */
  async function doFetch(this: StorageAreaLike, url: string, options?: StorageFetchOptions) {
    try {
      const res = (await requestNewer(
        url,
        init ? init(options) : options === "res" ? undefined : options,
      )) as VMReq.Response | void;
      if (res) {
        const response = res;
        const result = transform
          ? await transform(response, url, options)
          : "data" in response
            ? response.data
            : undefined;
        await this.setOne(url, result);
        if (options === "res") {
          return result;
        }
      }
    } finally {
      delete requests[url];
    }
  }
}

/**
 * @param {string} url
 * @param {VMReq.OptionsMulti} [opts]
 * @return {Promise<VMReq.Response> | void}
 */
export async function requestNewer(
  url: string,
  opts?: VMReq.OptionsMulti,
): Promise<VMReq.Response | void> {
  if (isDataUri(url)) {
    return;
  }
  let multi: VMReq.OptionsMulti["multi"];
  let modOld: number | undefined;
  let modDate: number | undefined;
  const isLocal = !isRemote(url);
  if (!isLocal && opts && (multi = opts[MULTI])) {
    const modInfo = await (storage.mod as StorageAreaLike).getOne?.(url);
    if (Array.isArray(modInfo)) {
      [modOld, modDate] = modInfo as [number, number];
    }
  }
  if (multi === AUTO && (modDate || 0) > Date.now() - getUpdateInterval()) {
    return;
  }
  for (const get of multi ? [0, 1] : [1]) {
    if (modOld || get) {
      const req = (await (isLocal || isCdnUrlRe.test(url) ? request : requestLimited)(
        url,
        get ? opts : ({ ...opts, ...NO_CACHE, method: "HEAD" } as VMReq.Options),
      )) as VMReq.Response;
      if (!("headers" in req)) {
        return;
      }
      const { headers } = req;
      const mod =
        headers.get("etag") ||
        +new Date(headers.get("last-modified")) ||
        +new Date(headers.get("date"));
      if (mod && mod === modOld) {
        return;
      }
      if (get) {
        if (mod) (storage.mod as StorageAreaLike).setOne(url, [mod, Date.now()]);
        else if (modOld) (storage.mod as StorageAreaLike).remove?.(url);
        return req;
      }
    }
  }
}
