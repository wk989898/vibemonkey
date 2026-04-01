import { expect, test } from "vitest";
import {
  promptRequestsClose,
  promptRequestsNewScript,
  promptRequestsSave,
  promptRequestsScriptGeneration,
} from "@/common/ai-script-intent";

test("promptRequestsSave detects explicit save intent in English and Chinese", () => {
  expect(promptRequestsSave("Create a script and save it now")).toBe(true);
  expect(promptRequestsSave("创建一个脚本并保存")).toBe(true);
  expect(promptRequestsSave("Create a script")).toBe(false);
});

test("promptRequestsNewScript detects save-as-new prompts", () => {
  expect(promptRequestsNewScript("Save this as a new script")).toBe(true);
  expect(promptRequestsNewScript("把这个脚本另存为新脚本")).toBe(true);
  expect(promptRequestsNewScript("Save this script")).toBe(false);
});

test("promptRequestsClose detects explicit close intent", () => {
  expect(promptRequestsClose("Save it and close the editor")).toBe(true);
  expect(promptRequestsClose("保存后关闭")).toBe(true);
  expect(promptRequestsClose("Save it")).toBe(false);
});

test("promptRequestsScriptGeneration detects userscript creation requests", () => {
  expect(promptRequestsScriptGeneration("Create a script for this page")).toBe(true);
  expect(promptRequestsScriptGeneration("帮我创建一个油猴脚本")).toBe(true);
  expect(promptRequestsScriptGeneration("What does this script tag do?")).toBe(false);
});
