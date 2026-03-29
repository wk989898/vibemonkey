declare global {
  const global: Window &
    typeof globalThis & {
      cloneInto?: <T>(value: T, target: object) => T;
      createObjectIn?: (target: object, as?: { defineAs?: string }) => object;
      exportFunction?: <T extends (...args: any[]) => any>(func: T, target: object) => T;
      vmData?: VMInjection;
      vmResolve?: (value: VMInjection) => void;
    };
  const VIOLENTMONKEY: string;
  const AUTO: "auto";
  const CONTENT: "content";
  const ERROR: "error";
  const EXPOSE: "expose";
  const FORCE_CONTENT: "forceContent";
  const INIT_FUNC_NAME: string;
  const IDS: "ids";
  const ID_BAD_REALM: -1;
  const ID_INJECTING: 2;
  const INJECT_INTO: "injectInto";
  const MORE: "more";
  const PAGE: "page";
  const RUN_AT: "runAt";
  const SCRIPTS: "scripts";
  const VALUES: "values";
  const kResponse: "response";
  const kResponseHeaders: "responseHeaders";
  const kResponseText: "responseText";
  const kResponseType: "responseType";
  const kSessionId: "sessionId";
  const kTop: "top";
  const kXhrType: "xhrType";
  const SKIP_SCRIPTS: "SkipScripts";
  const kFileName: "fileName";

  const SafePromise: PromiseConstructor;
  const SafeError: ErrorConstructor;
  const ResponseProto: typeof Response.prototype;
  const SafeResponse: typeof Response;
  const SafeBlob: typeof Blob;
  const SafeSymbol: typeof Symbol;
  const SafeUint8Array: typeof Uint8Array;
  const SafeDOMParser: typeof DOMParser;
  const SafeDOMException: typeof DOMException;
  const SafeEventTarget: typeof EventTarget;
  const SafeProxy: typeof Proxy;
  const safeApply: <T>(
    target: (...args: any[]) => T,
    thisArgument: unknown,
    argumentsList: ArrayLike<unknown>,
  ) => T;
  const safeBind: <T extends (...args: any[]) => any>(
    func: T,
    thisArg: unknown,
    ...args: unknown[]
  ) => (...rest: unknown[]) => ReturnType<T>;
  const safeCall: <T>(func: (...args: any[]) => T, thisArg: unknown, ...args: any[]) => T;
  const hasOwnProperty: (obj: object, key: PropertyKey) => boolean;

  const IS_APPLIED: "isApplied";
  let IS_FIREFOX: boolean | number;
  const PAGE_MODE_HANDSHAKE: string;
  let topRenderMode: VMTopRenderMode;
  const ROUTE_SCRIPTS: string;
  const extensionRoot: string;
  const extensionOrigin: string;
  const extensionManifest: chrome.runtime.Manifest;
  const MV3: boolean;
  const extensionOptionsPage: string;
  const ICON_PREFIX: string;
  const TAB_SETTINGS: "settings";
  const TAB_ABOUT: "about";
  const TAB_RECYCLE: "recycleBin";
  const BROWSER_ACTION: "action" | "browser_action";
  const kDocumentId: "documentId";
  const kFrameId: "frameId";
  const INJECT: "inject";
  const MULTI: "multi";
  const kWindowId: "windowId";
  const VM_UUID: string;
  const VAULT: unknown;
  const VAULT_ID: string;

  const PROTO: "prototype";
  const CALLBACK_ID: "__CBID";
  let logging: Console;
  const REIFY: "reify";
  const on: typeof globalThis.addEventListener;
  const off: typeof globalThis.removeEventListener;
  const fire: typeof globalThis.dispatchEvent;
  const cloneInto: (<T>(value: T, target: object) => T) | undefined;
  const assign: typeof Object.assign;
  const appendChild: typeof Node.prototype.appendChild;
  const append: typeof Element.prototype.append;
  const arrayIsArray: typeof Array.isArray;
  const attachShadow: typeof Element.prototype.attachShadow;
  const concat: typeof Array.prototype.concat;
  const filter: typeof Array.prototype.filter;
  const map: typeof Array.prototype.map;
  const safePush: <T>(arr: T[], val: T) => number;
  const createNullObj: <T extends object = Record<string, any>>() => T;
  const defineProperty: typeof Object.defineProperty;
  const forEach: typeof Array.prototype.forEach;
  let builtinGlobals: [string[], string[] | undefined] | null;
  const builtinFuncs: Record<string, PropertyDescriptor>;
  const formDataEntries: typeof FormData.prototype.entries;
  const getElementsByTagName: typeof Document.prototype.getElementsByTagName;
  const getWindowLength: (this: Window) => number;
  const getWindowParent: (this: Window) => Window;
  const getPrototypeOf: typeof Object.getPrototypeOf;
  const mathRandom: typeof Math.random;
  const jsonParse: typeof JSON.parse;
  const jsonStringify: typeof JSON.stringify;
  const objectKeys: typeof Object.keys;
  const objectValues: typeof Object.values;
  const parseFromString: typeof DOMParser.prototype.parseFromString;
  const promiseThen: typeof Promise.prototype.then;
  const promiseResolve: <T>(val?: T) => Promise<T | undefined>;
  const isFunction: (val: unknown) => val is (...args: any[]) => any;
  const isInstance: (instance: unknown, safeOriginalProto: object) => boolean;
  const isPromise: (val: unknown) => val is Promise<unknown>;
  const isObject: (val: unknown) => val is Record<PropertyKey, any>;
  const isString: (val: unknown) => val is string;
  const safeGetUniqId: (prefix?: string) => string;
  const safePickInto: <T extends object, U extends object>(
    dst: T,
    src: U,
    keys: Array<keyof U & string>,
  ) => T & Partial<U>;
  const ensureNestedProp: <
    TBucket extends Record<PropertyKey, any>,
    TKey extends PropertyKey,
    TValue,
  >(
    obj: Record<PropertyKey, TBucket>,
    bucketId: PropertyKey,
    key: TKey,
    defaultValue?: TValue,
  ) => TBucket[TKey] | TValue;
  const describeProperty: typeof Object.getOwnPropertyDescriptor;
  const includes: typeof Array.prototype.includes;
  const indexOf: typeof Array.prototype.indexOf;
  const reflectOwnKeys: typeof Reflect.ownKeys;
  const setPrototypeOf: typeof Object.setPrototypeOf;
  const setAttribute: typeof Element.prototype.setAttribute;
  const stopImmediatePropagation: Event["stopImmediatePropagation"];
  const SafeCustomEvent: typeof CustomEvent;
  const SafeKeyboardEvent: typeof KeyboardEvent;
  const SafeMouseEvent: typeof MouseEvent;
  const SafePromiseConstructor: object;
  const toStringTagSym: symbol;
  const URLToString: typeof URL.prototype.toString;
  const getCurrentScript: (this: Document) => HTMLOrSVGScriptElement | null;
  const getDetail: (this: CustomEvent) => unknown;
  const getRelatedTarget: (this: MouseEvent) => EventTarget | null;
  const exportFunction: <T extends (...args: any[]) => any>(func: T, target: object) => T;
  const safeAtob: typeof atob;
  const safeCharCodeAt: (text: string, index: number) => number;
  const stringIndexOf: (this: string, searchString: string, position?: number) => number;
  const slice: typeof String.prototype.slice;
  const log: (level: string, ...args: unknown[]) => void;
  const remove: typeof Element.prototype.remove;
  const throwIfProtoPresent: ((obj: unknown) => void) | undefined;
  const setOwnProp: <T extends object>(
    obj: T,
    key: PropertyKey,
    value: unknown,
    mutable?: boolean,
    valueKey?: "set" | "get",
  ) => T;
  const getOwnProp: <T>(
    obj: object | null | undefined,
    key: PropertyKey,
    defVal?: T,
  ) => T | undefined;
  const nullObjFrom: <T extends object>(src: T) => T;
  const urlSearchParamsToString: typeof URLSearchParams.prototype.toString;
}

declare module "~icons/*" {
  const component: import("vue").DefineComponent<Record<string, never>, Record<string, never>, any>;
  export default component;
}

declare module "~icons/mdi/*" {
  const component: import("vue").DefineComponent<Record<string, never>, Record<string, never>, any>;
  export default component;
}

declare global {
  interface FileSystemHandleWithUrl extends FileSystemHandle {
    _url?: string;
  }

  interface Document {
    prerendering?: boolean;
    requestStorageAccessFor?: unknown;
  }

  interface DataTransferItem {
    getAsFileSystemHandle?: () => Promise<FileSystemHandle>;
  }

  interface Window {
    fsh?: FileSystemHandleWithUrl;
    _bg?: 0 | 1;
    deepCopy?: typeof import("@/common/object").deepCopy;
    handleCommandMessage?: (payload: unknown, fakeSrc?: unknown) => Promise<unknown>;
  }

  interface Error {
    isRuntime?: boolean;
  }
}

export {};
