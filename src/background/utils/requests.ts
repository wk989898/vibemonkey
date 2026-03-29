import { blob2base64, sendTabCmd, string2uint8array } from "@/common";
import { CHARSET_UTF8, FORM_URLENCODED, UA_PROPS, UPLOAD } from "@/common/consts";
import { downloadBlob } from "@/common/download";
import { deepEqual, forEachEntry, forEachValue, objectPick } from "@/common/object";
import cache from "./cache";
import { addPublicCommands, commands } from "./init";
import {
  FORBIDDEN_HEADER_RE,
  VM_VERIFY,
  requests,
  toggleHeaderInjector,
  verify,
  kCookie,
  kSetCookie,
} from "./requests-core";
import { getFrameDocIdAsObj, getFrameDocIdFromSrc } from "./tabs";
import { FIREFOX, navUA, navUAD } from "./ua";
import { vetUrl } from "./url";

const { TextDecoder: SafeTextDecoder } = globalThis;
addPublicCommands({
  /**
   * @param {GMReq.Message.Web} opts
   * @param {VMMessageSender} src
   * @return {Promise<void>}
   */
  HttpRequest(opts, src) {
    const tabId = src.tab.id;
    const frameId = getFrameDocIdFromSrc(src);
    const { id, events } = opts;
    /** @type {GMReq.BG} */
    const req = (requests[id] = {
      id,
      tabId,
      [kFrameId]: frameId,
      frame: getFrameDocIdAsObj(frameId),
      ...(!FETCH_TRANSPORT && { xhr: new XMLHttpRequest() }),
    });
    const cb = (res) => requests[id] && sendTabCmd(tabId, "HttpRequested", res, req.frame);
    return httpRequest(opts, events, src, cb).catch((err) =>
      cb({
        id,
        [ERROR]: [err.message || `${err}`, err.name],
        data: null,
        type: ERROR,
      }),
    );
  },
  /** @return {void} */
  AbortRequest(id) {
    const req = requests[id];
    if (req?.abort) req.abort();
    else req?.xhr?.abort();
  },
  RevokeBlob(url) {
    const timer = cache.pop(`xhrBlob:${url}`);
    if (timer) {
      clearTimeout(timer as ReturnType<typeof setTimeout>);
      URL.revokeObjectURL(url);
    }
  },
});

/* 1MB takes ~20ms to encode/decode so it doesn't block the process of the extension and web page,
 * which lets us and them be responsive to other events or user input. */
const CHUNK_SIZE = 1e6;
const TEXT_CHUNK_SIZE = IS_FIREFOX
  ? 256e6 // Firefox: max 512MB and string char is 2 bytes (unicode)
  : 10e6; // Chrome: max 64MB and string char is 6 bytes max (like \u0001 in internal JSON)
const BLOB_LIFE = 60e3;
const FETCH_TRANSPORT = MV3 && !IS_FIREFOX;
const LOAD = "load";
const LOADEND = "loadend";
const LOADSTART = "loadstart";
const PROGRESS = "progress";
const READYSTATECHANGE = "readystatechange";
const ABORT = "abort";
const TIMEOUT = "timeout";
const SEND_XHR_PROPS = ["readyState", "status", "statusText"];
const SEND_PROGRESS_PROPS = ["lengthComputable", "loaded", "total"];
const quoteHeaderValue = (str) => `"${str.replace(/[\\"]/g, "\\$&")}"`;
const SEC_CH_UA = "sec-ch-ua";
const CHARSET_RE = /charset\s*=\s*(?:"([^"]+)"|([^;,\s]+))/i;
const UA_GETTERS = {
  __proto__: null,
  "user-agent": (val) => val,
  /** @param {NavigatorUABrandVersion[]} brands */
  [SEC_CH_UA]: (brands) =>
    brands.map((b) => `${quoteHeaderValue(b.brand)};v="${b.version}"`).join(", "),
  [SEC_CH_UA + "-mobile"]: (val) => `?${val ? 1 : 0}`,
  [SEC_CH_UA + "-platform"]: quoteHeaderValue,
};
const UA_HEADERS = Object.keys(UA_GETTERS);

function blob2chunk(response, index, size) {
  return blob2base64(response, index * size, size);
}

function blob2objectUrl(response) {
  const url = URL.createObjectURL(response);
  cache.put(`xhrBlob:${url}`, setTimeout(URL.revokeObjectURL, BLOB_LIFE, url), BLOB_LIFE);
  return url;
}

function text2chunk(response, index, size) {
  return response.substr(index * size, size);
}

/**
 * @param {GMReq.BG} req
 * @param {GMReq.EventTypeMap[]} events
 * @param {boolean} blobbed
 * @param {boolean} chunked
 * @param {boolean} isJson
 */
function xhrCallbackWrapper(req, events, blobbed, chunked, isJson) {
  let lastPromise = Promise.resolve();
  let contentType;
  let dataSize;
  let numChunks = 0;
  let chunkSize;
  let getChunk;
  let fullResponse = null;
  let response;
  let responseHeaders;
  let sent = true;
  let sentTextLength = 0;
  let sentReadyState4;
  let tmp;
  const { id, xhr } = req;
  const getResponseHeaders = () => req[kResponseHeaders] || xhr.getAllResponseHeaders();
  const eventQueue = [];
  const sequentialize = async () => {
    const evt = eventQueue.shift();
    const upload = evt.target === xhr ? 0 : 1;
    const { type } = evt;
    const shouldNotify = events[upload][type];
    const isEnd = !upload && type === "loadend";
    const readyState4 = xhr.readyState === 4 || (sentReadyState4 = false); // reset on redirection
    if (!shouldNotify && !isEnd && type !== ERROR) {
      return;
    }
    // Firefox duplicates readystatechange for state=4 randomly, #1862
    if (readyState4 && type === "readystatechange") {
      if (sentReadyState4) return;
      sentReadyState4 = true;
    }
    if (!contentType) {
      contentType = xhr.getResponseHeader("Content-Type") || "";
    }
    if (!upload && fullResponse !== xhr[kResponse]) {
      fullResponse = response = xhr[kResponse];
      sent = false;
      if (response) {
        if ((tmp = response.length - sentTextLength)) {
          // a non-empty text response has `length`
          chunked = tmp > TEXT_CHUNK_SIZE;
          chunkSize = TEXT_CHUNK_SIZE;
          dataSize = tmp;
          getChunk = text2chunk;
          response = sentTextLength ? response.slice(sentTextLength) : response;
          sentTextLength += dataSize;
        } else {
          chunkSize = CHUNK_SIZE;
          dataSize = response.size;
          getChunk = blobbed ? blob2objectUrl : blob2chunk;
        }
        numChunks = chunked ? Math.ceil(dataSize / chunkSize) || 1 : blobbed ? 1 : 0;
      }
    }
    if (response && isEnd && req[kFileName]) {
      downloadBlob(response, req[kFileName]);
    }
    const shouldSendResponse = !upload && shouldNotify && (!isJson || readyState4) && !sent;
    if (shouldSendResponse) {
      sent = true;
      for (let i = 1; i < numChunks; i += 1) {
        await req.cb({
          id,
          i,
          chunk: i * chunkSize,
          data: await getChunk(response, i, chunkSize),
          size: dataSize,
        });
      }
    }
    /* WARNING! We send `null` in the mandatory props because Chrome can't send `undefined`,
     * and for simple destructuring and `prop?.foo` in the receiver without getOwnProp checks. */
    await req.cb({
      blobbed,
      chunked,
      contentType,
      id,
      type,
      /** @type {VMScriptResponseObject} */
      data: shouldNotify
        ? {
            finalUrl: req.url || xhr.responseURL,
            ...objectPick(xhr, SEND_XHR_PROPS),
            ...objectPick(evt, SEND_PROGRESS_PROPS),
            [kResponse]: shouldSendResponse
              ? numChunks
                ? await getChunk(response, 0, chunkSize)
                : response
              : null,
            [kResponseHeaders]:
              responseHeaders !== (tmp = getResponseHeaders()) ? (responseHeaders = tmp) : null,
          }
        : null,
      [UPLOAD]: upload,
    });
    if (isEnd) {
      clearRequest(req);
    }
  };
  return (evt) => {
    eventQueue.push(evt);
    lastPromise = lastPromise.then(sequentialize);
  };
}

/**
 * @param {GMReq.Message.Web} opts
 * @param {GMReq.EventTypeMap[]} events
 * @param {VMMessageSender} src
 * @param {function} cb
 * @returns {Promise<void>}
 */
async function httpRequest(opts, events, src, cb) {
  const { tab } = src;
  const { incognito } = tab;
  const { anonymous, id, overrideMimeType, [kXhrType]: xhrType } = opts;
  const url = vetUrl(opts.url, src.url, true);
  const req = requests[id];
  if (!req || req.cb) return;
  req.cb = cb;
  req[kFileName] = opts[kFileName];
  const vmHeaders = {};
  const headers = new Headers();
  let authHeader;
  // Firefox can send Blob/ArrayBuffer directly
  const willStringifyBinaries = xhrType && !IS_FIREFOX;
  // Chrome can't fetch Blob URL in incognito so we use chunks
  const chunked = willStringifyBinaries && incognito;
  const blobbed = willStringifyBinaries && !incognito;
  const [body, contentType] = decodeBody(opts.data);
  // Firefox doesn't send cookies, https://github.com/violentmonkey/violentmonkey/issues/606
  // Both Chrome & FF need explicit routing of cookies in containers or incognito
  const shouldSendCookies = !FETCH_TRANSPORT && !anonymous && (incognito || IS_FIREFOX);
  const uaHeaders = [];
  req[kCookie] = !anonymous && (FETCH_TRANSPORT || !shouldSendCookies);
  req[kSetCookie] = !anonymous;
  if (contentType) headers.set("Content-Type", contentType);
  headers.set(VM_VERIFY, id);
  forEachEntry.call(opts.headers, ([name, value]) => {
    const nameLow = name.toLowerCase();
    const i = UA_HEADERS.indexOf(nameLow);
    if (nameLow === "authorization") {
      authHeader = true;
    }
    if ((i >= 0 && (uaHeaders[i] = true)) || FORBIDDEN_HEADER_RE.test(name)) {
      pushWebRequestHeader(
        vmHeaders,
        name,
        value,
        nameLow,
        nameLow === kCookie && !anonymous ? "append" : "set",
      );
    } else {
      headers.set(name, value);
    }
  });
  if (!authHeader && (opts.user || opts.password)) {
    headers.set("Authorization", `Basic ${btoa(`${opts.user || ""}:${opts.password || ""}`)}`);
  }
  opts.ua.forEach((val, i) => {
    if (!uaHeaders[i] && !deepEqual(val, !i ? navUA : navUAD[UA_PROPS[i]])) {
      const name = UA_HEADERS[i];
      pushWebRequestHeader(vmHeaders, name, UA_GETTERS[name](val), name, "set");
    }
  });
  const method = opts.method || "GET";
  const { xhr } = req;
  if (shouldSendCookies) {
    for (const store of await browser.cookies.getAllCookieStores()) {
      if (store.tabIds.includes(tab.id)) {
        if (IS_FIREFOX ? !store.id.endsWith("-default") : store.id !== "0") {
          /* Cookie routing. For the main store we rely on the browser.
           * The ids are hard-coded as `stores` may omit the main store if no such tabs are open. */
          req.storeId = store.id;
        }
        break;
      }
    }
    const now = Date.now() / 1000;
    const cookies = (
      await browser.cookies.getAll({
        url,
        storeId: req.storeId,
        ...(FIREFOX >= 59 && { firstPartyDomain: null }),
      })
    ).filter((c) => c.session || c.expirationDate > now); // FF reports expired cookies!
    if (cookies.length) {
      pushWebRequestHeader(
        vmHeaders,
        kCookie,
        cookies.map((c) => `${c.name}=${c.value};`).join(" "),
      );
    }
  }
  await toggleHeaderInjector(id, vmHeaders, FETCH_TRANSPORT && { method, url });
  if (FETCH_TRANSPORT) {
    return httpRequestFetch({
      body,
      blobbed: false,
      events,
      headers,
      method,
      overrideMimeType,
      req,
      url,
      xhrType,
      anonymous,
      timeout: opts.timeout,
    });
  }
  xhr.open(method, url, true, opts.user || "", opts.password || "");
  headers.forEach((value, name) => {
    xhr.setRequestHeader(name, value);
  });
  xhr[kResponseType] = (willStringifyBinaries && "blob") || xhrType || "text";
  xhr.timeout = Math.max(0, Math.min(0x7fff_ffff, opts.timeout)) || 0;
  if (overrideMimeType) xhr.overrideMimeType(overrideMimeType);
  // Sending as params to avoid storing one-time init data in `requests`
  const callback = xhrCallbackWrapper(
    req,
    events,
    blobbed,
    chunked,
    opts[kResponseType] === "json",
  );
  const onerror = "on" + ERROR;
  for (const evt in events[0]) xhr[`on${evt}`] = callback;
  for (const evt in events[1]) xhr[UPLOAD][`on${evt}`] = callback;
  xhr.onloadend = callback; // always send it for the internal cleanup
  xhr.onabort = callback; // for gmxhr().abort()
  xhr[onerror] = xhr[UPLOAD][onerror] = callback; // show it in tab's console if there's no callback
  xhr.send(body);
}

async function httpRequestFetch({
  body,
  blobbed,
  events,
  headers,
  method,
  overrideMimeType,
  req,
  timeout,
  url,
  xhrType,
  anonymous,
}) {
  const controller = new AbortController();
  const { signal } = controller;
  let timer;
  let timedOut;
  req.abort = () => controller.abort();
  if (timeout > 0) {
    timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      Math.min(0x7fff_ffff, timeout),
    );
  }
  try {
    if (events[0][READYSTATECHANGE]) {
      await sendFetchEvent(req, READYSTATECHANGE, {
        readyState: 1,
        status: 0,
        statusText: "",
        finalUrl: url,
      });
    }
    if (events[0][LOADSTART]) {
      await sendFetchEvent(req, LOADSTART, {
        readyState: 1,
        status: 0,
        statusText: "",
        finalUrl: url,
      });
    }
    const response = await fetch(url, {
      body,
      credentials: anonymous ? "omit" : "include",
      headers,
      method,
      redirect: "follow",
      signal,
    });
    const finalUrl = req.url || response.url || url;
    const status = response.status || 200;
    const statusText = response.statusText || "";
    const responseHeaders = req[kResponseHeaders] || encodeFetchHeaders(response.headers);
    const finalType = overrideMimeType || response.headers.get("content-type") || "";
    const total = +response.headers.get("content-length") || 0;
    const lengthComputable = total > 0;
    if (events[0][READYSTATECHANGE]) {
      await sendFetchEvent(req, READYSTATECHANGE, {
        readyState: 2,
        status,
        statusText,
        finalUrl,
        responseHeaders,
      });
    }
    const { data: raw, loaded } = await loadFetchResponse(response, finalType, xhrType);
    if (
      events[0][READYSTATECHANGE] &&
      raw &&
      (!xhrType ? raw.length : raw.size || raw.byteLength)
    ) {
      await sendFetchEvent(req, READYSTATECHANGE, {
        readyState: 3,
        status,
        statusText,
        finalUrl,
        responseHeaders,
      });
    }
    const sendResponseWith = events[0][LOAD]
      ? LOAD
      : events[0][READYSTATECHANGE]
        ? READYSTATECHANGE
        : LOADEND;
    if (events[0][PROGRESS]) {
      await sendFetchEvent(req, PROGRESS, {
        readyState: 3,
        status,
        statusText,
        finalUrl,
        responseHeaders,
        lengthComputable,
        loaded,
        total,
      });
    }
    if (events[0][READYSTATECHANGE]) {
      await sendFetchEvent(req, READYSTATECHANGE, {
        readyState: 4,
        status,
        statusText,
        finalUrl,
        responseHeaders,
        response: sendResponseWith === READYSTATECHANGE && raw,
        contentType: finalType,
        chunked: xhrType ? true : !xhrType && raw?.length > TEXT_CHUNK_SIZE,
        blobbed,
        lengthComputable,
        loaded,
        total,
      });
    }
    if (events[0][LOAD]) {
      await sendFetchEvent(req, LOAD, {
        readyState: 4,
        status,
        statusText,
        finalUrl,
        responseHeaders,
        response: sendResponseWith === LOAD && raw,
        contentType: finalType,
        chunked: xhrType ? true : !xhrType && raw?.length > TEXT_CHUNK_SIZE,
        blobbed,
        lengthComputable,
        loaded,
        total,
      });
    }
    await sendFetchEvent(req, LOADEND, {
      readyState: 4,
      status,
      statusText,
      finalUrl,
      responseHeaders,
      response: sendResponseWith === LOADEND && raw,
      contentType: finalType,
      chunked: xhrType ? true : !xhrType && raw?.length > TEXT_CHUNK_SIZE,
      blobbed,
      lengthComputable,
      loaded,
      total,
    });
    if (req[kFileName] && raw?.size && typeof document !== "undefined") {
      downloadBlob(raw, req[kFileName]);
    }
  } catch (err) {
    const type = timedOut ? TIMEOUT : err?.name === "AbortError" ? ABORT : ERROR;
    if (type === ERROR) {
      await req.cb({
        id: req.id,
        [ERROR]: [err.message || `${err}`, err.name],
        data: null,
        type,
      });
    } else {
      await sendFetchEvent(req, type, {
        readyState: 4,
        status: 0,
        statusText: "",
        finalUrl: req.url || url,
      });
    }
    await sendFetchEvent(req, LOADEND, {
      readyState: 4,
      status: 0,
      statusText: "",
      finalUrl: req.url || url,
    });
  } finally {
    clearTimeout(timer);
    clearRequest(req);
  }
}

async function sendFetchEvent(req, type, details) {
  const {
    blobbed,
    chunked,
    contentType,
    finalUrl,
    lengthComputable,
    loaded,
    readyState,
    response,
    responseHeaders,
    status,
    statusText,
    total,
  } = details;
  let responseData = null;
  if (response != null) {
    const isBlob = isObject(response);
    const useChunks = chunked || isBlob;
    const size = isBlob ? response.size : response.length;
    const sizePerChunk = isBlob ? CHUNK_SIZE : TEXT_CHUNK_SIZE;
    const getChunk = isBlob ? blob2chunk : text2chunk;
    const numChunks = useChunks ? Math.ceil(size / sizePerChunk) || 1 : 0;
    for (let i = 1; i < numChunks; i += 1) {
      await req.cb({
        id: req.id,
        i,
        chunk: i * sizePerChunk,
        data: await getChunk(response, i, sizePerChunk),
        size,
      });
    }
    responseData = useChunks ? await getChunk(response, 0, sizePerChunk) : response;
  }
  await req.cb({
    blobbed,
    chunked,
    contentType,
    id: req.id,
    type,
    data: {
      finalUrl,
      readyState,
      status,
      statusText,
      lengthComputable: !!lengthComputable,
      loaded: loaded || 0,
      total: total || 0,
      [kResponse]: responseData,
      [kResponseHeaders]: responseHeaders != null ? responseHeaders : null,
    },
    [UPLOAD]: 0,
  });
}

async function loadFetchResponse(response, contentType, xhrType) {
  if (xhrType) {
    const blob = await response.blob();
    return {
      data: blob,
      loaded: blob.size,
    };
  }
  const buffer = await response.arrayBuffer();
  return {
    data: decodeText(buffer, contentType),
    loaded: buffer.byteLength,
  };
}

function decodeText(buffer, contentType) {
  const label = CHARSET_RE.exec(contentType || "")?.[1] || CHARSET_RE.exec(contentType || "")?.[2];
  try {
    return new SafeTextDecoder(label || "utf-8").decode(buffer);
  } catch (e) {
    return new SafeTextDecoder().decode(buffer);
  }
}

function encodeFetchHeaders(headers) {
  let encoded = "";
  headers.forEach((value, name) => {
    encoded += `${name}: ${value}\r\n`;
  });
  return encoded;
}

/** @param {GMReq.BG} req */
function clearRequest({ id, coreId }) {
  delete verify[coreId];
  delete requests[id];
  toggleHeaderInjector(id, false);
}

export function clearRequestsByTabId(tabId, frameId) {
  forEachValue.call(requests, (req) => {
    if ((tabId == null || req.tabId === tabId) && (!frameId || req[kFrameId] === frameId)) {
      commands.AbortRequest(req.id);
    }
  });
}

export function reifyRequests(tabId, documentId) {
  const frameObj = getFrameDocIdAsObj(0);
  forEachValue.call(requests, (req) => {
    if (req.tabId === tabId && req[kFrameId] === documentId) {
      req[kFrameId] = 0;
      req.frame = frameObj;
    }
  });
}

/** Polyfill for browser's inability to send complex types over extension messaging */
function decodeBody([body, type, wasBlob]) {
  if (type === "fd") {
    // FF supports FormData over messaging
    // Chrome doesn't - we use this code only with an empty FormData just to create the object
    const res = new FormData();
    body.forEach((entry) => res.append(entry[0], entry[1]));
    body = res;
    type = "";
  } else if (type === "usp") {
    type = FORM_URLENCODED + ";" + CHARSET_UTF8;
  } else if (type != null) {
    const res = string2uint8array(undefined, body.slice(body.indexOf(",") + 1));
    if (!wasBlob) {
      type = body.match(/^data:(.+?);base64/)[1].replace(
        /(boundary=)[^;]+/,
        // using a function so it runs only if "boundary" was found
        (_, p1) => p1 + String.fromCharCode(...res.slice(2, res.indexOf(13))),
      );
    }
    body = res;
  }
  return [body, type];
}

/**
 * @param {Object} res
 * @param {string} name
 * @param {string} value
 * @param {string} [nameLow]
 * @param {string} [operation]
 */
function pushWebRequestHeader(res, name, value, nameLow = name, operation = undefined) {
  res[nameLow] = { name, value, operation };
}
