import { expect, test } from "vitest";
import { normalizeBgError } from "@/common/ui/setting-text-errors";

test("normalizeBgError handles nullish values", () => {
  expect(normalizeBgError(null)).toBeNull();
  expect(normalizeBgError(undefined)).toBeNull();
});

test("normalizeBgError preserves plain error messages", () => {
  expect(normalizeBgError({ message: "plain error" })).toBe("plain error");
});

test("normalizeBgError unwraps single-item JSON arrays", () => {
  expect(normalizeBgError({ message: '["only one"]' })).toBe("only one");
});

test("normalizeBgError unwraps multi-item JSON arrays", () => {
  expect(normalizeBgError({ message: '["first","second"]' })).toEqual(["first", "second"]);
});
