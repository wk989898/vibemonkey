import bridge from "./bridge";
import { GM4_ALIAS, GM_API, GM_API_CTX, GM_API_CTX_GM4ASYNC, gmCookieInvoker } from "./gm-api";
import { makeGlobalWrapper } from "./gm-global-wrapper";
import { makeComponentUtils, safeCopy, thisObjectProto } from "./util";

/** @type {(keyof VMInjection.Script)[]} */
const COPY_SCRIPT_PROPS = ["displayName", "id"];
const componentUtils = makeComponentUtils();
const kResources = "resources";
const bridgeEx = bridge as typeof bridge & {
  gmi?: VMInjection.Info["gmi"];
  ua?: VMScriptGMInfoPlatform;
  uad?: boolean;
};
const getUA = () => bridge.call("UA", undefined);
const getUAHints = (hints: string[]) => bridge.promise("UAH", hints);
const getUAData = () =>
  bridgeEx.uad && setOwnProp(bridge.call("UAD", undefined), "getHighEntropyValues", getUAHints);
const sendTabClose = () => bridge.post("TabClose", undefined);
const sendTabFocus = () => bridge.post("TabFocus", undefined);

/**
 * @param {VMInjection.Script} script
 * @returns {Object}
 */
export function makeGmApiWrapper(script) {
  // Add GM functions
  // Reference: http://wiki.greasespot.net/Greasemonkey_Manual:API
  const { meta } = script;
  const { grant } = meta;
  const resources = setPrototypeOf(meta[kResources] as StringMap, null);
  const gmInfo = script.gmi;
  const gm4 = createNullObj();
  const gm: Record<string, any> & {
    GM: Record<string, any>;
    c?: unknown;
    unsafeWindow?: Window & typeof globalThis;
  } = {
    __proto__: null,
    GM: gm4,
  };
  let contextAsync;
  let grantless;
  let wrapper;
  defineGmInfoProps(makeGmInfo, "get");
  // Sandbox is enabled unless explicitly disabled via `none`, #2404
  if (safeCall(indexOf, grant, "none") < 0) {
    /** @type {GMContext} */
    const context = safePickInto(
      {
        [kResources]: resources,
        resCache: createNullObj(),
        async: false,
      },
      script,
      COPY_SCRIPT_PROPS,
    );
    assign(gm, componentUtils);
    gm.unsafeWindow = global as Window & typeof globalThis;
    for (let name of grant) {
      let fn, fnAsync, gm4name;
      if (safeCall(slice, name, 0, 3) === "GM." && (gm4name = safeCall(slice, name, 3))) {
        name = "GM_" + gm4name;
        fn = fnAsync = GM4_ALIAS[gm4name];
      }
      if (fn || (fn = GM_API_CTX[name]) || (fn = fnAsync = GM_API_CTX_GM4ASYNC[name])) {
        const ctx =
          fnAsync && gm4name
            ? (contextAsync ??= assign(createNullObj(), context, {
                async: true,
              }))
            : context;
        if (fn === gmCookieInvoker) {
          fn = {
            __proto__: null,
            delete: safeBind(fn, ctx, "CookieDelete", /*hasResult=*/ false),
            list: safeBind(fn, ctx, "CookieList", /*hasResult=*/ true),
            set: safeBind(fn, ctx, "CookieSet", /*hasResult=*/ false),
          };
        } else {
          fn = safeBind(fn, ctx);
        }
      } else if (
        !(fn = GM_API[name]) &&
        (fn =
          (name === "window.close" && sendTabClose) || (name === "window.focus" && sendTabFocus))
      ) {
        name = safeCall(slice, name, 7); // 'window.'.length
      }
      if (fn) {
        if (gm4name) gm4[gm4name] = fn;
        else gm[name] = fn;
      }
    }
    wrapper = makeGlobalWrapper(gm, (grantless = !grant.length && createNullObj()));
    /* Exposing the fast cache of resolved properties,
     * using a name that'll never be added to the web platform */
    gm.c = gm;
  }
  return {
    gm,
    wrapper,
    grantless,
  };
  function defineGmInfoProps(value: unknown, getter?: "get") {
    setOwnProp(gm, "GM_info", value, true, getter);
    setOwnProp(gm4, "info", value, true, getter);
  }
  function makeGmInfo() {
    setPrototypeOf(gmInfo, null); // enable safe direct assignment
    meta[kResources] = objectKeys(resources).map((name) => ({
      name,
      url: resources[name],
    })) as (typeof meta)[typeof kResources];
    assign(gmInfo, bridgeEx.gmi);
    gmInfo[INJECT_INTO] = bridge.mode;
    gmInfo.platform = safeCopy(bridgeEx.ua || {});
    gmInfo.script = meta;
    gmInfo.scriptHandler = VIOLENTMONKEY;
    gmInfo.version = process.env.VM_VER;
    setOwnProp(gmInfo, "userAgent", getUA, true, "get");
    setOwnProp(gmInfo, "userAgentData", getUAData, true, "get");
    defineGmInfoProps(gmInfo);
    return setPrototypeOf(gmInfo, thisObjectProto); // return as a standard Object
  }
}
