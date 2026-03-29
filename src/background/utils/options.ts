import { compareVersion, debounce, initHooks, normalizeKeys, sendCmd } from "@/common";
import { deepCopy, deepEqual, objectGet, objectSet } from "@/common/object";
import defaults, { kScriptTemplate } from "@/common/options-defaults";
import { addOwnCommands, init } from "./init";
import storage from "./storage";

type OptionKey = string | string[] | number | null | undefined;
type OptionsData = Record<string, any>;
type OptionHook = (data: OptionsData, firstRun?: boolean) => void;

let changes: OptionsData | null = null;

addOwnCommands({
  /** @return {Object} */
  GetAllOptions() {
    return Object.assign({}, defaults, options);
  },
  /**
   * @param {{ [key:string]: PlainJSONValue }} data
   * @return {void}
   * @throws {?} hooks can throw after the option was set */
  SetOptions(data) {
    for (const key in data) setOption(key, data[key], true);
    callHooks(); // exceptions will be sent to the caller
  },
});

const options: OptionsData = {};
export const kOptions = "options";
export const kVersion = "version";
const TPL_OLD_VAL = `\
// ==UserScript==
// @name New Script
// @namespace Violentmonkey Scripts
// @match {{url}}
// @grant none
// ==/UserScript==
`;
const DELAY = 100;
const hooks = initHooks<[OptionsData]>();
const callHooksLater = debounce(callHooks, DELAY);
const writeOptionsLater = debounce(writeOptions, DELAY);
const optProxy = new Proxy(defaults as OptionsData, {
  get: (_target, key) => getOption(key as string),
});
export const hookOptions = hooks.hook;
hookOptions((data) => sendCmd("UpdateOptions", data));

export function initOptions(
  data: Record<string, any>,
  lastVersion: string,
  versionChanged: boolean,
) {
  data = data[kOptions] || {};
  Object.assign(options, data);
  if (process.env.DEBUG) console.info("options:", options);
  if (!options[kVersion]) {
    setOption(kVersion, 1);
  }
  if (options[kScriptTemplate] === TPL_OLD_VAL) {
    options[kScriptTemplate] = defaults[kScriptTemplate]; // will be detected by omitDefaultValue below
  }
  if (Object.keys(options).map(omitDefaultValue).some(Boolean)) {
    delete options[`${kScriptTemplate}Edited`]; // TODO: remove this in 2023
    writeOptionsLater();
  }
  if (versionChanged) {
    let key, val;
    if (
      IS_FIREFOX &&
      options[(key = "defaultInjectInto")] === PAGE &&
      compareVersion(lastVersion, "2.12.7") <= 0
    ) {
      options[key] = AUTO;
    }
    if (
      (val = options.filters) &&
      val[(key = "sort")] === "exec" &&
      compareVersion(lastVersion, "2.31.2") <= 0
    ) {
      val[key] += "-"; // Until reverse sort was implemented, 'size' was reversed by design
    }
  }
}

/**
 * @param {!string} key - must be "a.b.c" to allow clients easily set inside existing object trees
 * @param {PlainJSONValue} [value]
 * @param {boolean} [silent] - in case you callHooks() directly yourself afterwards
 */
function addChange(key: string, value: PlainJSONValue, silent?: boolean) {
  if (!changes) changes = {};
  else delete changes[key]; // Deleting first to place the new value at the end
  changes[key] = value;
  if (!silent) callHooksLater();
}

/** @throws in option handlers */
function callHooks() {
  if (!changes) return; // may happen in callHooksLater if callHooks was called earlier
  const tmp = changes;
  changes = null;
  hooks.fire(tmp);
}

/** Hooks and calls the callback with a copy of all options when init is resolved */
export function hookOptionsInit(cb: OptionHook) {
  if (init) init.then(() => cb(optProxy, true));
  else cb(optProxy, true);
  return hookOptions(cb);
}

export function getOption(key: OptionKey) {
  const directKey = typeof key === "string" || typeof key === "number" ? `${key}` : null;
  let res = directKey ? options[directKey] : undefined;
  if (res != null) return res;
  const keys = normalizeKeys(key);
  const mainKey = keys[0];
  const value = options[mainKey] ?? defaults[mainKey];
  return deepCopy(keys.length > 1 ? objectGet(value, keys.slice(1)) : value);
}

export function setOption(key: OptionKey, value: PlainJSONValue, silent?: boolean) {
  if (init) return init.then(() => setOption(key, value, silent));
  const keys = normalizeKeys(key);
  const mainKey = keys[0];
  key = keys.join("."); // must be a string for addChange()
  if (!hasOwnProperty(defaults, mainKey)) {
    if (process.env.DEBUG) console.info("Unknown option:", key, value, options);
    return;
  }
  const subKey = keys.length > 1 && keys.slice(1);
  const mainVal = getOption([mainKey]);
  if (deepEqual(value, subKey ? objectGet(mainVal, subKey) : mainVal)) {
    if (process.env.DEBUG) console.info("Option unchanged:", key, value, options);
    return;
  }
  options[mainKey] = subKey ? objectSet(mainVal, subKey, value) : value;
  omitDefaultValue(mainKey);
  writeOptionsLater();
  addChange(key, value, silent);
  if (process.env.DEBUG) console.info("Options updated:", key, value, options);
}

function writeOptions() {
  return storage.base.setOne(kOptions, options);
}

function omitDefaultValue(key: string) {
  return deepEqual(options[key], defaults[key]) && delete options[key];
}
