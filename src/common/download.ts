import { makePause } from "@/common";
import { addPublicCommands } from "@/background/utils";

let chain: Promise<unknown> = Promise.resolve();

addPublicCommands({
  DownloadBlob(args: Parameters<typeof downloadBlob>) {
    downloadBlob(...args);
  },
});

/**
 * @param {Blob|string} what
 * @param {string} name
 * @param {boolean} force
 */
export function downloadBlob(what: Blob | string, name = "", force = false) {
  // Frequent downloads are ignored in Chrome and possibly other browsers
  if (!force) {
    chain = chain.then(() => (downloadBlob(what, name, true), makePause(150)));
    return;
  }
  const url = isObject(what) ? URL.createObjectURL(what) : what;
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  if (isObject(what)) makePause(3000).then(() => URL.revokeObjectURL(url));
}
