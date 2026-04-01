import { afterEach, expect, test } from "vitest";
import storage, { getStorageKeys } from "@/background/utils/storage";

const originalApi = storage.api;

afterEach(() => {
  storage.api = originalApi;
});

test("getStorageKeys keeps the storage area receiver", async () => {
  const api = {
    get() {
      return Promise.resolve({});
    },
    getKeys() {
      return Promise.resolve(this === api ? ["alpha", "beta"] : ["wrong-this"]);
    },
    remove() {
      return Promise.resolve();
    },
    set() {
      return Promise.resolve();
    },
  };

  storage.api = api as unknown as typeof storage.api;

  await expect(getStorageKeys()).resolves.toEqual(["alpha", "beta"]);
});
