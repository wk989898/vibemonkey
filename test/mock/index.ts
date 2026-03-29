import { vi } from "vitest";

type GlobalWithMocks = typeof globalThis & {
  browser: typeof chrome;
  chrome: typeof chrome;
  PAGE_MODE_HANDSHAKE: number;
  VAULT_ID: boolean;
};

type URLWithBlobCache = typeof URL & {
  blobCache: Record<string, Blob>;
};

globalThis.MessageChannel ||= MessageChannel;
globalThis.MessagePort ||= MessagePort;
globalThis.TextEncoder ||= TextEncoder;
globalThis.TextDecoder ||= TextDecoder;

const extensionApi = {
  storage: {
    local: {
      get() {
        return Promise.resolve({});
      },
      set() {
        return Promise.resolve();
      },
    },
  },
  extension: {
    isAllowedFileSchemeAccess: () => false,
  },
  runtime: {
    getURL: (path: string) => path,
    getManifest: () => ({
      icons: { 16: "" },
      options_ui: {},
    }),
    getPlatformInfo: async () => ({}),
  },
  tabs: {
    onRemoved: { addListener: () => {} },
    onReplaced: { addListener: () => {} },
    onUpdated: { addListener: () => {} },
  },
  windows: {
    getAll: () => [{}],
    getCurrent: () => ({}),
  },
} as unknown as typeof chrome;

Object.assign(globalThis as GlobalWithMocks, {
  browser: extensionApi,
  chrome: extensionApi,
});

if (!window.Response) {
  (window as Window & { Response?: { prototype: object } }).Response = { prototype: {} };
}

const domProps = Object.getOwnPropertyDescriptors(window);
for (const key of Object.keys(domProps)) {
  // Skip ***Storage and native global methods.
  if (key.endsWith("Storage") || (/^[a-z]/.test(key) && key in globalThis)) {
    delete domProps[key];
  }
}
Object.defineProperties(globalThis, domProps);

if (globalThis.MessagePort?.prototype) {
  delete MessagePort.prototype.onmessage; // avoid hanging
}

Object.assign(globalThis as GlobalWithMocks, {
  PAGE_MODE_HANDSHAKE: 123,
  VAULT_ID: false,
});

const URLWithCache = URL as URLWithBlobCache;
Object.assign(URLWithCache, {
  blobCache: {},
  createObjectURL(blob: Blob) {
    const blobUrl = `blob:${Math.random()}`;
    URLWithCache.blobCache[blobUrl] = blob;
    return blobUrl;
  },
});

Object.assign(globalThis, await import("@/common/safe-globals-shared"));
Object.assign(globalThis, await import("@/common/safe-globals"));
Object.assign(globalThis, await import("@/injected/safe-globals"));
Object.assign(globalThis, await import("@/injected/content/safe-globals"));
Object.assign(globalThis, await import("@/injected/web/safe-globals"));

vi.stubGlobal("chrome", extensionApi);
vi.stubGlobal("browser", extensionApi);
