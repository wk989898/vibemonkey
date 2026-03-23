import { buffer2string, escapeStringForRegExp, getUniqId, isEmpty, noop } from '@/common';
import { forEachEntry } from '@/common/object';
import { CHROME } from './ua';

let encoder;
let dnrRuleCounter = 1;

export const VM_VERIFY = getUniqId('VM-Verify');
/** @type {Object<string,GMReq.BG>} */
export const requests = { __proto__: null };
export const verify = { __proto__: null };
export const FORBIDDEN_HEADER_RE = re`/
^(
  # prefix matches
  proxy-|
  sec-
)|^(
  # whole name matches
  # https://developer.mozilla.org/en-US/docs/Glossary/Forbidden_header_name
  # https://cs.chromium.org/?q=file:cc+symbol:IsForbiddenHeader%5Cb
  accept-(charset|encoding)|
  access-control-request-(headers|method)|
  connection|
  content-length|
  cookie2?|
  date|
  dnt|
  expect|
  host|
  keep-alive|
  origin|
  referer|
  te|
  trailer|
  transfer-encoding|
  upgrade|
  via
)$/ix`;
/** @type {chrome.webRequest.RequestFilter} */
const API_FILTER = {
  urls: ['<all_urls>'],
  types: ['xmlhttprequest'],
};
const EXTRA_HEADERS = [
  browser.webRequest.OnBeforeSendHeadersOptions.EXTRA_HEADERS,
].filter(Boolean);
const CAN_BLOCK_HEADERS = !MV3;
const headersToInject = {};
const headersRuleIds = {};
const dnr = !CAN_BLOCK_HEADERS && browser.declarativeNetRequest;
/** @param {chrome.webRequest.HttpHeader} header */
const isVmVerify = header => header.name === VM_VERIFY;
export const kCookie = 'cookie';
export const kSetCookie = 'set-cookie';
const SET_COOKIE_VALUE_RE = re`
  /^\s*  (?:__(Secure|Host)-)?  ([^=\s]+)  \s*=\s*  (")?  ([!#-+\--:<-[\]-~]*)  \3(.*)  /x`;
const SET_COOKIE_ATTR_RE = re`
  /\s*  ;?\s*  (\w+)  (?:= (")?  ([!#-+\--:<-[\]-~]*)  \2)?  /xy`;
const SAME_SITE_MAP = {
  strict: 'strict',
  lax: 'lax',
  none: 'no_restriction',
};
const kRequestHeaders = 'requestHeaders';
const API_EVENTS = {
  onBeforeSendHeaders: [
    onBeforeSendHeaders, kRequestHeaders, ...(CAN_BLOCK_HEADERS ? ['blocking'] : []), ...EXTRA_HEADERS,
  ],
  onHeadersReceived: [
    onHeadersReceived, kResponseHeaders, ...(CAN_BLOCK_HEADERS ? ['blocking'] : []), ...EXTRA_HEADERS,
  ],
};

/** @param {chrome.webRequest.WebRequestHeadersDetails} details */
function onHeadersReceived({ [kResponseHeaders]: headers, requestId, url }) {
  const req = requests[verify[requestId]];
  if (req) {
    // Populate responseHeaders for GM_xhr's `response`
    req[kResponseHeaders] = headers.map(encodeWebRequestHeader).join('');
    if (!CAN_BLOCK_HEADERS) return;
    const { storeId } = req;
    // Drop Set-Cookie headers if anonymous or using a custom storeId
    if (!req[kSetCookie] || storeId) {
      headers = headers.filter(h => {
        if (h.name.toLowerCase() !== kSetCookie) return true;
        if (storeId) setCookieInStore(h.value, storeId, url);
      });
      return { [kResponseHeaders]: headers };
    }
  }
}

/** @param {chrome.webRequest.WebRequestHeadersDetails} details */
function onBeforeSendHeaders({ [kRequestHeaders]: headers, requestId, url }) {
  // only the first call during a redirect/auth chain will have VM-Verify header
  const reqId = verify[requestId] || headers.find(isVmVerify)?.value;
  const req = requests[reqId];
  if (req) {
    verify[requestId] = reqId;
    req.coreId = requestId;
    req.url = url; // remember redirected URL with #hash as it's stripped in XHR.responseURL
    const headersMap = {};
    const headers2 = headersToInject[reqId];
    const combinedHeaders = headers2 && {};
    let name;
    let h2 = !headers2;
    for (const h of headers) {
      if ((name = h.name) === VM_VERIFY
      || (name = name.toLowerCase()) === 'origin' && h.value === extensionOrigin
      || name === kCookie && !req[kCookie]) {
        continue;
      }
      if (!h2 && name === kCookie && (h2 = headers2[name])) {
        combinedHeaders[name] = { name, value: h.value + '; ' + h2.value };
      } else {
        headersMap[name] = h;
      }
    }
    if (CAN_BLOCK_HEADERS) {
      return {
        [kRequestHeaders]: Object.values(Object.assign(headersMap, headers2, combinedHeaders))
      };
    }
  }
}

export function toggleHeaderInjector(reqId, headers, reqInfo) {
  if (headers) {
    /* Listening even if `headers` array is empty to get the request's id.
     * Registering just once to avoid a bug in Chrome:
     * it adds a new internal registration even if the function reference is the same */
    if (isEmpty(headersToInject)) {
      API_EVENTS::forEachEntry(([name, [listener, ...options]]) => {
        browser.webRequest[name].addListener(listener, API_FILTER, options);
      });
    }
    // Adding even if empty so that the toggle-off `if` runs just once even when called many times
    headersToInject[reqId] = headers;
    return !CAN_BLOCK_HEADERS && updateSessionRule(reqId, headers, reqInfo);
  } else if (reqId in headersToInject) {
    delete headersToInject[reqId];
    const promise = !CAN_BLOCK_HEADERS && updateSessionRule(reqId, false);
    if (isEmpty(headersToInject)) {
      API_EVENTS::forEachEntry(([name, [listener]]) => {
        browser.webRequest[name].removeListener(listener);
      });
    }
    return promise;
  }
}

function updateSessionRule(reqId, headers, reqInfo) {
  if (!dnr) return;
  const removeRuleIds = [];
  const oldRuleId = headersRuleIds[reqId];
  if (oldRuleId) {
    removeRuleIds.push(oldRuleId);
    delete headersRuleIds[reqId];
  }
  const addRules = !headers || isEmpty(headers) ? null : [buildSessionRule(reqId, headers, reqInfo)];
  if (!addRules && !removeRuleIds.length) {
    return;
  }
  return dnr.updateSessionRules({
    ...(addRules && { addRules }),
    ...(removeRuleIds.length && { removeRuleIds }),
  }).catch(err => {
    console.warn('[requests] updateSessionRules failed', err);
  });
}

function buildSessionRule(reqId, headers, reqInfo) {
  const id = dnrRuleCounter++;
  const method = reqInfo?.method?.toLowerCase?.() || 'get';
  const url = reqInfo.url.split('#', 1)[0];
  headersRuleIds[reqId] = id;
  return {
    id,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: Object.values(headers).map(({ name, value, operation }) => ({
        header: name,
        operation: operation || 'set',
        ...(value != null && { value }),
      })),
    },
    condition: {
      regexFilter: `^${escapeStringForRegExp(url)}$`,
      requestMethods: [method],
      resourceTypes: ['xmlhttprequest'],
      tabIds: [chrome.tabs.TAB_ID_NONE],
    },
  };
}

/**
 * Imitating https://developer.mozilla.org/docs/Web/API/XMLHttpRequest/getAllResponseHeaders
 * Per the specification https://tools.ietf.org/html/rfc7230 the header name is within ASCII,
 * but we'll try encoding it, if necessary, to handle invalid server responses.
 */
function encodeWebRequestHeader({ name, value, binaryValue }) {
  return `${string2byteString(name)}: ${
    binaryValue
      ? buffer2string(binaryValue)
      : string2byteString(value)
  }\r\n`;
}

/**
 * @param {string} headerValue
 * @param {string} storeId
 * @param {string} url
 */
function setCookieInStore(headerValue, storeId, url) {
  let m = SET_COOKIE_VALUE_RE.exec(headerValue);
  if (m) {
    const [, prefix, name, , value, optStr] = m;
    const opt = {};
    const isHost = prefix === 'Host';
    SET_COOKIE_ATTR_RE.lastIndex = 0;
    while ((m = SET_COOKIE_ATTR_RE.exec(optStr))) {
      opt[m[1].toLowerCase()] = m[3];
    }
    const sameSite = opt.sameSite?.toLowerCase();
    browser.cookies.set({
      url,
      name,
      value,
      domain: isHost ? undefined : opt.domain,
      expirationDate: Math.max(0, +new Date(opt['max-age'] * 1000 || opt.expires)) || undefined,
      httpOnly: 'httponly' in opt,
      path: isHost ? '/' : opt.path,
      sameSite: SAME_SITE_MAP[sameSite],
      secure: url.startsWith('https:') && (!!prefix || sameSite === 'none' || 'secure' in opt),
      storeId,
    });
  }
}

/**
 * Returns a UTF8-encoded binary string i.e. one byte per character.
 * Returns the original string in case it was already within ASCII.
 */
function string2byteString(str) {
  if (!/[\u0080-\uFFFF]/.test(str)) return str;
  if (!encoder) encoder = new TextEncoder();
  return buffer2string(encoder.encode(str));
}

// Chrome 74-91 needs an extraHeaders listener at tab load start, https://crbug.com/1074282
// We're attaching a no-op in non-blocking mode so it's very lightweight and fast.
if (CHROME >= 74 && CHROME <= 91) {
  browser.webRequest.onBeforeSendHeaders.addListener(noop, API_FILTER, EXTRA_HEADERS);
}
