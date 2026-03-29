import { isCdnUrlRe, isDataUri, isRemote, makeRaw, request, tryUrl } from "@/common";
import { VM_HOME } from "@/common/consts";
import limitConcurrency from "@/common/limit-concurrency";
import { addOwnCommands } from "./init";
import { testBlacklistNet } from "./tester";

type BackgroundRequestOptions = VMReq.Options & {
  url: string;
  vet?: boolean;
};

export const requestLimited = limitConcurrency(
  request,
  4,
  100,
  1000,
  (url: string) => url.split("/")[2], // simple extraction of the `host` part
);

addOwnCommands({
  async Request({ url, vet, ...opts }: BackgroundRequestOptions) {
    const vettedUrl = vet ? vetUrl(url) : url;
    const fn = isRemote(vettedUrl) && !isCdnUrlRe.test(vettedUrl) ? requestLimited : request;
    const res = (await fn(vettedUrl, opts)) as VMReq.Response;
    return opts[kResponseType] === "blob" ? makeRaw(res) : "data" in res ? res.data : undefined; // TODO: if we ever need headers, send it as [...headers] to make it transferable
  },
});

/**
 * @param {string} url
 * @param {string} [base]
 * @param {boolean} [throwOnFailure]
 * @returns {string} a resolved `url` or `data:,Invalid URL ${url}`
 */
export function vetUrl(url: string, base = VM_HOME, throwOnFailure?: boolean): string {
  let res: string | undefined;
  let err: string | false | undefined;
  if (isDataUri(url)) {
    res = url;
  } else {
    res = tryUrl(url, base);
    err = !res
      ? "Invalid"
      : (res.startsWith(extensionRoot) || testBlacklistNet(res)) && "Blacklisted";
    if (err) {
      err = `${err} URL ${res || url}`;
      if (throwOnFailure) throw err;
      res = `data:,${err}`;
    }
  }
  return res;
}
