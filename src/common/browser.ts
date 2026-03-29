const runtimeGlobal = (typeof globalThis === "object" ? globalThis : window) as typeof globalThis &
  { browser?: any };
let browser = runtimeGlobal.browser;
const kAddListener = "addListener";
const kRemoveListener = "removeListener";

type AnyFunc = (...args: any[]) => any;
type ApiMeta = 0 | AnyFunc | Record<PropertyKey, unknown>;
type WrappedError = Error & Record<string, any>;

// Since this also runs in a content script we'll guard against implicit global variables
// for DOM elements with 'id' attribute which is a standard feature, more info:
// https://github.com/mozilla/webextension-polyfill/pull/153
// https://html.spec.whatwg.org/multipage/window-object.html#named-access-on-the-window-object
if (!IS_FIREFOX && !browser?.runtime) {
  const { Proxy: SafeProxy } = runtimeGlobal;
  const { bind } = SafeProxy;
  const MESSAGE = "message";
  const STACK = "stack";
  const isSyncMethodName = (key: PropertyKey) =>
    key === kAddListener ||
    key === kRemoveListener ||
    key === "hasListener" ||
    key === "hasListeners";
  /** API types or enums or literal constants */
  const proxifyValue = (
    target: Record<PropertyKey, unknown>,
    key: PropertyKey,
    src: Record<PropertyKey, unknown>,
    metaVal?: ApiMeta,
  ) => {
    const srcVal = src[key];
    if (srcVal === undefined) return;
    let res;
    if (isFunction(metaVal)) {
      res = metaVal(src, srcVal);
    } else if (isFunction(srcVal)) {
      res =
        metaVal === 0 || isSyncMethodName(key) || !hasOwnProperty(src, key)
          ? safeCall(bind, srcVal, src)
          : wrapAsync(src, srcVal);
    } else if (isObject(srcVal) && metaVal !== 0) {
      res = proxifyGroup(srcVal, metaVal);
    } else {
      res = srcVal;
    }
    target[key] = res;
    return res;
  };
  const proxifyGroup = (
    src: Record<PropertyKey, unknown>,
    meta?: ApiMeta,
  ): Record<PropertyKey, unknown> => {
    const handler: ProxyHandler<Record<PropertyKey, unknown>> = {
      get: (group, key) =>
        group[key] ??
        proxifyValue(
          group,
          key,
          src,
          (meta as Record<PropertyKey, unknown> | undefined)?.[key] as ApiMeta | undefined,
        ),
    };
    return new SafeProxy({ __proto__: null }, handler);
  };
  /**
   * @param {Object} thisArg - original API group
   * @param {function} func - original API function
   * @param {WrapAsyncPreprocessorFunc} [preprocessorFunc] - modifies the API callback's response
   */
  const wrapAsync =
    (
      thisArg: object,
      func: AnyFunc,
      preprocessorFunc?: (resolve: (value: unknown) => void, response: unknown) => unknown,
    ) =>
    (...args: unknown[]) => {
      let resolve!: (value: unknown) => void;
      let reject!: (reason?: unknown) => void;
      /* Using resolve/reject to call API in the scope of this function, not inside Promise,
       because an API validation exception is thrown synchronously both in Chrome and FF
       so the caller can use try/catch to detect it like we've been doing in icon.js */
      const promise = new SafePromise((_resolve, _reject) => {
        resolve = _resolve;
        reject = _reject;
      });
      // Make the error messages actually useful by capturing a real stack
      const stackInfo = new SafeError(
        `callstack before invoking ${func.name || "chrome API"}:`,
      ) as WrappedError;
      // A single parameter `result` is fine because we don't use API that return more
      const cb = (result: unknown) => {
        const runtimeErr = chrome.runtime.lastError;
        const err =
          runtimeErr || (preprocessorFunc ? preprocessorFunc(resolve, result) : resolve(result));
        // Prefer `reject` over `throw` which stops debugger in 'pause on exceptions' mode
        if (err) {
          if (!runtimeErr) stackInfo[STACK] = `${err[1]}\n${stackInfo[STACK]}`;
          stackInfo[MESSAGE] = runtimeErr ? err[MESSAGE] : `${err[0]}`;
          stackInfo.isRuntime = !!runtimeErr;
          reject(stackInfo);
        }
      };
      if (process.env.IS_INJECTED) {
        safePush(args, cb); /* global safePush */
        try {
          safeApply(func, thisArg, args);
        } catch (e) {
          if ((e as Record<string, unknown>)[MESSAGE] === "Extension context invalidated.") {
            /* global logging */ // only used with process.env.IS_INJECTED=content
            logging.error(`Please reload the tab to restore ${VIOLENTMONKEY} API for userscripts.`);
          } else {
            throw e;
          }
        }
      } else {
        /* Not process.env.IS_INJECTED */
        safeCall(func, thisArg, ...args, cb);
      }
      if (process.env.DEBUG) promise.catch((err) => console.warn(args, err?.[MESSAGE] || err));
      return promise;
    };
  const wrapResponse = (result: unknown, error?: unknown) => {
    if (process.env.DEBUG) console[error ? "warn" : "log"]("sendResponse", error || result);
    return [
      result ?? null,
      // `undefined` is not transferable in Chrome, but `null` is
      error && (error[MESSAGE] ? [error[MESSAGE], error[STACK]] : [error, new SafeError()[STACK]]),
    ];
  };
  const sendResponseAsync = async (
    result: Promise<unknown>,
    sendResponse: (response: ReturnType<typeof wrapResponse>) => void,
  ) => {
    try {
      sendResponse(wrapResponse(await result));
    } catch (err) {
      sendResponse(wrapResponse(0, err));
    }
  };
  const onMessageListener = (
    listener: (message: unknown, sender: browser.runtime.MessageSender) => unknown,
    message: unknown,
    sender: browser.runtime.MessageSender,
    sendResponse: (response: ReturnType<typeof wrapResponse>) => void,
  ) => {
    if (process.env.DEBUG) console.info("receive", message);
    try {
      const result = listener(message, sender);
      if (
        result &&
        (process.env.IS_INJECTED
          ? isPromise(result) /* global isPromise */
          : result instanceof Promise)
      ) {
        sendResponseAsync(result as Promise<unknown>, sendResponse);
        return true;
      } else if (result !== undefined) {
        /* WARNING: when using onMessage in extension pages don't use `async`
         * and make sure to return `undefined` for content messages like GetInjected */
        sendResponse(wrapResponse(result));
      }
    } catch (err) {
      sendResponse(wrapResponse(0, err));
    }
  };
  /** @type {WrapAsyncPreprocessorFunc} */
  const unwrapResponse = (resolve: (value: unknown) => void, response: [unknown, unknown]) =>
    (!response && "null response") ||
    response[1] || // error created in wrapResponse
    resolve(response[0]); // result created in wrapResponse
  const wrapSendMessage = (runtime: object, sendMessage: AnyFunc) =>
    wrapAsync(runtime, sendMessage, unwrapResponse);
  /**
   * 0 = non-async method or the entire group
   * function = transformer like (originalObj, originalFunc): function
   */
  browser = runtimeGlobal.browser = proxifyGroup(
    chrome as Record<PropertyKey, unknown>,
    {
      extension: 0,
      // we don't use its async methods
      i18n: 0,
      // we don't use its async methods
      runtime: {
        connect: 0,
        getManifest: 0,
        getURL: 0,
        onMessage: {
          [kAddListener]: (onMessage: object, addListener: AnyFunc) => (listener: AnyFunc) => {
            if (process.env.DEV && !process.env.IS_INJECTED && /^async/.test(String(listener))) {
              throw new Error("onMessage listener cannot be async");
              // ...because it must be able to return `undefined` for unintended messages
              // to allow onMessage of the intended context to handle this message
              // TODO: migrate to addRuntimeListener(fn, commands: object)
            }
            return safeCall(
              addListener,
              onMessage,
              safeCall(bind, onMessageListener, null, listener),
            );
          },
        },
        sendMessage: wrapSendMessage,
      },
      tabs: !process.env.IS_INJECTED && {
        connect: 0,
        sendMessage: wrapSendMessage,
      },
    },
  );
} else if (process.env.DEBUG && IS_FIREFOX) {
  // this is a debug-only section
  let counter = 0;
  const { runtime } = browser;
  const { sendMessage, onMessage } = runtime;
  const log = (type: string, args: unknown[], id: number, isResponse = false) =>
    console.info(`${type}Message#%d${isResponse ? " response" : ""}`, id, ...args);
  runtime.sendMessage = (...args: unknown[]) => {
    counter += 1;
    const id = counter;
    log("send", args, id);
    const promise = safeCall(sendMessage, runtime, ...args) as Promise<unknown>;
    promise.then((data) => log("send", [data], id, true), console.warn);
    return promise;
  };
  const { addListener } = onMessage;
  onMessage.addListener = (listener: AnyFunc) =>
    safeCall(addListener, onMessage, (msg, sender) => {
      counter += 1;
      const id = counter;
      const { frameId, tab, url } = sender;
      log(
        "on",
        [
          msg,
          {
            frameId,
            tab,
            url,
          },
        ],
        id,
      );
      const result = listener(msg, sender);
      const promise = isFunction((result as Promise<unknown> | undefined)?.then)
        ? (result as Promise<unknown>)
        : SafePromise.resolve(result);
      promise.then((data) => log("on", [data], id, true), console.warn);
      return result;
    });
}

/**
 * @callback WrapAsyncPreprocessorFunc
 * @param {function(any)} resolve - called on success
 * @param {any} response - API callback's response
 * @returns {?string[]} - [errorMessage, errorStack] array on error
 */

export default browser;

/** @this {object} browser api event like browser.tabs.onRemoved */
export function listenOnce(cb) {
  const event = this;
  const onceFn = (data) => {
    event[kRemoveListener](onceFn);
    cb(data);
  };
  event[kAddListener](onceFn);
}
