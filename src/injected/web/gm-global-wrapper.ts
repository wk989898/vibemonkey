import { FastLookup, safeConcat, safeCopy } from "./util";
const kConsole = "console";
const scopeSym = SafeSymbol.unscopables as symbol;
const globalDesc: Record<PropertyKey, PropertyDescriptor | undefined> = createNullObj();
/** Original ~50 global functions such as setTimeout that some sites override.
 * Not saving all globals because it would waste a lot of time on each page and frame. */
const globalFunctionDesc: Record<PropertyKey, PropertyDescriptor | undefined> = createNullObj();
const globalKeysSet = FastLookup();
const globalKeys = (function makeGlobalKeys() {
  const kWrappedJSObject = "wrappedJSObject";
  const isContentMode = !PAGE_MODE_HANDSHAKE;
  const names = builtinGlobals[0]; // `window` keys
  const numFrames = safeCall(getWindowLength, window);
  // True if `names` is usable as is, but FF is bugged: its names have duplicates
  let ok = !IS_FIREFOX;
  let desc;
  let v;
  for (const key of names) {
    const frameIndex = +key;
    if (
      (frameIndex >= 0 && frameIndex < numFrames) ||
      (isContentMode &&
        (key === process.env.INIT_FUNC_NAME || key === "browser" || key === "chrome"))
    ) {
      ok = false;
    } else {
      globalKeysSet.set(key, 1);
      /* Saving built-in global descriptors except constructors and onXXX events,
         checking length>=3 to prevent calling String.prototype index getters */
      if (
        key >= "a" &&
        key <= "z" &&
        (key.length < 3 || key[0] !== "o" || key[1] !== "n") &&
        (desc = builtinFuncs[key] || describeProperty(window, key))
      ) {
        setPrototypeOf(desc, null); // to read desc.XXX without calling Object.prototype getters
        (desc.enumerable && isFunction(desc.value) ? globalFunctionDesc : globalDesc)[key] = desc;
        if (key === kConsole && isObject((v = desc.value))) desc.value = nullObjFrom(v);
      }
    }
  }
  /* Chrome and FF page mode: `global` is `window`
     FF content mode: `global` is different, some props e.g. `isFinite` are defined only there */
  if (global !== window) {
    safeCall(forEach, builtinGlobals[1], (key) => {
      if (!(+key >= 0 && key < numFrames)) {
        // Using `!` to avoid the need to use and safe-guard isNaN
        globalKeysSet.set(key, -1);
        ok = false;
      }
    });
  }
  // wrappedJSObject is not included in getOwnPropertyNames so we add it explicitly.
  if (
    IS_FIREFOX &&
    !PAGE_MODE_HANDSHAKE &&
    kWrappedJSObject in global &&
    !globalKeysSet.get(kWrappedJSObject)
  ) {
    globalKeysSet.set(kWrappedJSObject, 1);
    if (ok) setOwnProp(names, names.length, kWrappedJSObject);
  }
  return ok ? names : globalKeysSet.toArray();
})();
const inheritedDesc: Record<PropertyKey, PropertyDescriptor | undefined> = createNullObj();
const isChildWindowKey = (key) =>
  isString(key) /* skipping Symbol as it throws on conversion */ &&
  (key = +key) >= 0 /* is number */ &&
  key === (key | 0) /* is 32-bit integer, no fraction */ &&
  key < safeCall(getWindowLength, window);
const updateGlobalDesc = (name) => {
  let src;
  let isChild;
  const descFn = globalFunctionDesc[name];
  const desc =
    descFn ||
    inheritedDesc[name] ||
    ((src = globalKeysSet.get(name) || (isChild = isChildWindowKey(name))) &&
      describeProperty((src = src > 0 ? window : global), name));
  if (!desc) return;
  if (!descFn) setPrototypeOf(desc, null);
  else if (process.env.DEV && getPrototypeOf(desc)) throw "proto must be null";
  /* ~45 enumerable action functions belong to `window` and need to be bound to it,
   * the non-enum ~10 can be unbound, and `eval` MUST be unbound to run in scope. */
  if (descFn) {
    // TODO: switch to SafeProxy and preserve thisArg when it's not our wrapper or its cache?
    const fn = safeBind(desc.value, src === global ? global : window);
    desc.value = defineProperty(fn, "name", {
      __proto__: null,
      value: name,
    } as PropertyDescriptor);
    globalFunctionDesc[name] = undefined;
    globalDesc[name] = desc;
  } else if (!isChild) {
    // Using `!` to avoid the need to use and safe-guard isNaN
    globalDesc[name] = desc;
  }
  return desc;
};
safeCall(forEach, [SafeEventTarget, Object], (src) => {
  src = src[PROTO];
  for (const key of reflectOwnKeys(src)) {
    const desc = describeProperty(src, key);
    setPrototypeOf(desc, null); // to read desc.XXX without calling Object.prototype getters
    (isFunction(desc.value) ? globalFunctionDesc : inheritedDesc)[key] = desc;
  }
});
builtinGlobals = null;

/**
 * @desc Wrap helpers to prevent unexpected modifications.
 */
export function makeGlobalWrapper(local, grantless) {
  let globals = globalKeysSet; // will be copied only if modified
  /* Browsers may return [object Object] for Object.prototype.toString(window)
     on our `window` proxy so jQuery libs see it as a plain object and throw
     when trying to clone its recursive properties like `self` and `window`. */
  setOwnProp(local, toStringTagSym, () => "Window", false, "get");
  const events = createNullObj();
  const proxyHandler: ProxyHandler<Record<PropertyKey, unknown>> = createNullObj();
  let wrapper;
  proxyHandler.defineProperty = (_, name, desc) => {
    const globalProp = globalDesc[name] || updateGlobalDesc(name);
    if (name in local || !globalProp || globalProp.configurable) {
      if (grantless) grantless[name] = 1;
      /* It's up to caller to protect proto */
      return !!defineProperty(local, name, desc);
    }
  };
  proxyHandler.deleteProperty = (_, name) => {
    const deleted = delete local[name];
    const globalProp = deleted && (globalDesc[name] || updateGlobalDesc(name));
    if (deleted && globalProp?.configurable) {
      if (globals === globalKeysSet) {
        globals = globalKeysSet.clone();
      }
      globals.delete(name);
    }
    if (grantless) grantless[name] = 1;
    return deleted;
  };
  proxyHandler.get = (_, name) => {
    if (name === "undefined" || name === scopeSym) return;
    if ((_ = local[name]) !== undefined || name in local) return _;
    return proxyDescribe(local, name, wrapper, events, true);
  };
  proxyHandler.getOwnPropertyDescriptor = (_, name) =>
    describeProperty(local, name) || proxyDescribe(local, name, wrapper, events);
  proxyHandler.has = (_, name) =>
    !!(
      name in globalDesc ||
      name in local ||
      updateGlobalDesc(name) ||
      (grantless && (grantless[name] = 0))
    );
  proxyHandler.ownKeys = () => makeOwnKeys(local, globals);
  proxyHandler.preventExtensions = () => true;
  proxyHandler.set = (_, name, value) => {
    if (!(name in local)) proxyDescribe(local, name, wrapper, events);
    if (grantless) grantless[name] = 1;
    local[name] = value;
    return true;
  };
  wrapper = new SafeProxy(local, proxyHandler);
  return wrapper;
}
function makeOwnKeys(local, globals) {
  /** Note that arrays can be eavesdropped via prototype setters like '0','1',...
   * on `push` and `arr[i] = 123`, as well as via getters if you read beyond
   * its length or from an unassigned `hole`. */
  const frameIndexes = [];
  const len = safeCall(getWindowLength, window);
  for (let i = 0, str; i < len && getOwnProp(window, (str = `${i}`)) !== undefined; i += 1) {
    if (!(str in local)) safePush(frameIndexes, str);
  }
  return safeConcat(
    frameIndexes,
    globals === globalKeysSet ? globalKeys : globals.toArray(),
    safeCall(filter, reflectOwnKeys(local), notIncludedIn, globals.get),
  );
}
function proxyDescribe(local, name, wrapper, events, returnAsValue = false) {
  let known;
  let desc = (known = globalDesc[name]) || updateGlobalDesc(name);
  if (!desc) return;
  let { get, set, value } = desc;
  const isChild = !known && isChildWindowKey(name);
  const isWindow =
    value === window ||
    name === "window" ||
    name === "self" ||
    name === "globalThis" ||
    (name === "top" && window === top) || // `top` is unforgeable
    (name === "parent" && window === safeCall(getWindowParent, window));
  if (isWindow) {
    value = desc.value = wrapper;
    get = undefined;
    delete desc.get;
    delete desc.set;
  } else if (
    get &&
    set &&
    isString(name) &&
    // Spoofed String index getters won't be called within length, length itself is unforgeable
    name.length >= 3 &&
    name[0] === "o" &&
    name[1] === "n"
  ) {
    setWindowEvent(desc, name, events, wrapper);
  } else {
    if (get) desc.get = safeBind(get, window);
    if (set) desc.set = safeBind(set, window);
    if (value && name === kConsole) desc.value = value = safeCopy(value);
  }
  if (!isChild) {
    defineProperty(local, name, desc); /* proto is null */
  }
  return !returnAsValue ? desc : !get ? value : isChild ? global[name] : local[name];
}
function setWindowEvent(desc, name, events, wrapper) {
  name = safeCall(slice, name, 2);
  desc.get = () => events[name] || null;
  desc.set = (fn) => {
    safeCall(off, window, name, events[name]);
    if (isFunction(fn)) {
      // the handler will be unique so that one script couldn't remove something global
      // like console.log set by another script
      safeCall(
        on,
        window,
        name,
        (events[name] =
          // FF chokes on safeBind because the result belongs to Vault's window
          IS_FIREFOX && PAGE_MODE_HANDSHAKE
            ? (evt) => safeCall(fn, wrapper, evt)
            : safeBind(fn, wrapper)),
      );
    } else {
      delete events[name];
    }
  };
}

/** @this {FastLookup.get} */
function notIncludedIn(key) {
  return !this(key);
}
