/**
 * This file is used first by the entire `src` including `injected`.
 * `global` is used instead of relying on a bundler-provided polyfill.
 * Not exporting NodeJS built-in globals as this file is imported in the test scripts.
 */

const global = (typeof globalThis === "object" ? globalThis : this) as typeof globalThis;
const window = (global.window || global) as typeof globalThis;
export const VIOLENTMONKEY = "VibeMonkey";
export const AUTO = "auto";
export const CONTENT = "content";
export const ERROR = "error";
export const EXPOSE = "expose";
export const FORCE_CONTENT = "forceContent";
export const IDS = "ids";
export const ID_BAD_REALM = -1;
export const ID_INJECTING = 2;
export const INJECT_INTO = "injectInto";
export const MORE = "more";
export const PAGE = "page";
export const RUN_AT = "runAt";
export const SCRIPTS = "scripts";
export const VALUES = "values";
export const kResponse = "response";
export const kResponseHeaders = "responseHeaders";
export const kResponseText = "responseText";
export const kResponseType = "responseType";
export const kSessionId = "sessionId";
export const kTop = "top";
export const kXhrType = "xhrType";
export const SKIP_SCRIPTS = "SkipScripts";
export const isFunction = (val: unknown): val is (...args: any[]) => any =>
  typeof val === "function";
export const isObject = (val: unknown): val is Record<PropertyKey, any> =>
  val != null && typeof val === "object";
export const kFileName = "fileName";
