import { kGmCookieHttpOnly } from "@/common/options-defaults";
import { addPublicCommands } from "./init";
import { getOption } from "./options";
import { scriptMap } from "./script";
import { testScript } from "./tester";
import { FIREFOX } from "./ua";
import { vetUrl } from "./url";

type CookieOperationDetails = {
  domain?: string;
  firstPartyDomain?: string | null;
  httpOnly?: boolean;
  scriptId?: number;
  storeId?: string;
  url?: string;
} & Record<string, any>;

const MUST_MATCH = `Script must match/include `;
const FIRST_PARTY = (FIREFOX || 0) >= 59;

addPublicCommands({
  /**
   * @param {browser.cookies._GetAllDetails} data
   * @param {VMMessageSender} src
   * @return {Promise<browser.cookies.Cookie[]>}
   */
  async CookieList(data: CookieOperationDetails, src: VMMessageSender) {
    const httpOnlyEnabled = checkCookieOpts(data, src, FIRST_PARTY);
    const res = await browser.cookies.getAll(data as browser.cookies._GetAllDetails);
    return httpOnlyEnabled ? res : res.filter((c) => !c.httpOnly);
  },

  /**
   * @param {browser.cookies._SetDetails} data
   * @param {VMMessageSender} src
   */
  async CookieSet(data: CookieOperationDetails, src: VMMessageSender) {
    const httpOnlyEnabled = checkCookieOpts(data, src, false, true);
    const { url } = data;
    if (!url) {
      throw "Invalid URL for cookie";
    }
    if (!httpOnlyEnabled && data.httpOnly) {
      throw "HTTP-only cookie access is not allowed in settings";
    }
    data.secure ??= url.startsWith("https:");
    await browser.cookies.set(data as browser.cookies._SetDetails);
  },

  /**
   * @param {browser.cookies._RemoveDetails} data
   * @param {VMMessageSender} src
   */
  async CookieDelete(data: CookieOperationDetails, src: VMMessageSender) {
    checkCookieOpts(data, src, FIRST_PARTY);
    await browser.cookies.remove(data as browser.cookies._RemoveDetails);
  },
});

/**
 * @param {Object} data
 * @param {VMMessageSender} src
 * @param {boolean} [addFirstParty]
 * @param {boolean} [fallbackToSrcUrl]
 * @return {boolean}
 */
function checkCookieOpts(
  data: CookieOperationDetails,
  src: VMMessageSender,
  addFirstParty?: boolean,
  fallbackToSrcUrl?: boolean,
) {
  const { url, domain, scriptId } = data;
  const script = scriptMap[scriptId];
  if (!script) {
    throw `Script #${scriptId} not found`;
  }
  let targetUrl = url;
  if (!url && (!domain || fallbackToSrcUrl)) {
    targetUrl = src.url;
  }
  if (targetUrl) {
    targetUrl = vetUrl(targetUrl, src.url, true);
    if (!testScript(targetUrl, script)) {
      throw MUST_MATCH + targetUrl;
    }
  } else if (domain) {
    const checkUrl = `https://${domain.replace(/^\./, "")}/`;
    if (!testScript(checkUrl, script)) {
      throw MUST_MATCH + checkUrl;
    }
  }
  if (addFirstParty) data.firstPartyDomain ??= null;
  data.storeId ??= (
    src.tab as (browser.tabs.Tab & { cookieStoreId?: string }) | undefined
  )?.cookieStoreId;
  data.url = targetUrl;
  delete data.scriptId;
  return script.config.httpOnly && getOption(kGmCookieHttpOnly);
}
