import path from "path";
import { readGlobalsFile } from "../../scripts/webpack-util.mjs";

test("readGlobalsFile transpiles safe globals to executable JavaScript", () => {
  const files = [
    "src/common/safe-globals-shared",
    "src/common/safe-globals",
    "src/injected/safe-globals",
    "src/injected/content/safe-globals",
    "src/injected/web/safe-globals",
  ];
  for (const file of files) {
    const code = readGlobalsFile(path.resolve(file));
    expect(() => new Function(code)).not.toThrow();
  }
});

test("safe-globals-shared works in strict contexts", () => {
  const code = readGlobalsFile(path.resolve("src/common/safe-globals-shared"));
  const result = new Function(
    `"use strict";${code}; return { hasGlobal: typeof global === "object", hasWindow: typeof window === "object" };`,
  )();
  expect(result).toEqual({
    hasGlobal: true,
    hasWindow: true,
  });
});
