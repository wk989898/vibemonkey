import { afterEach, beforeEach, expect, test, vi } from "vitest";

const originalGlobal = globalThis.global;
const originalBrowser = globalThis.browser;

beforeEach(() => {
  vi.resetModules();
  delete globalThis.global;
  delete globalThis.browser;
});

afterEach(() => {
  globalThis.global = originalGlobal;
  globalThis.browser = originalBrowser;
});

test("common runtime modules work without the Node global alias", async () => {
  const browserModule = await import("@/common/browser");
  const constsModule = await import("@/common/consts");

  expect(browserModule.default.runtime).toBeDefined();
  expect(constsModule.browser?.runtime).toBeDefined();
});
