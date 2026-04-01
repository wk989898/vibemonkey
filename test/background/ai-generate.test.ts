import { expect, test } from "vitest";
import { extractGeneratePlan, extractGeneratedCode } from "@/background/utils/ai-generate";

test("extractGeneratePlan reads tool-plan blocks", () => {
  expect(
    extractGeneratePlan(`\`\`\`json
{"actions":[{"tool":"apply_code"},{"tool":"update_script_settings","settings":{"enabled":false,"tags":["ai","test"],"runAt":"document-end"}},{"tool":"save_script","mode":"create"}]}
\`\`\`
\`\`\`javascript
// ==UserScript==
\`\`\``),
  ).toEqual({
    actions: [
      { tool: "apply_code" },
      {
        settings: {
          enabled: false,
          runAt: "document-end",
          tags: ["ai", "test"],
        },
        tool: "update_script_settings",
      },
      { mode: "create", tool: "save_script" },
    ],
  });
});

test("extractGeneratePlan supports legacy action objects", () => {
  expect(
    extractGeneratePlan(`\`\`\`json
{"tool":"update_current_script","save":true,"close":true}
\`\`\`
\`\`\`javascript
// ==UserScript==
\`\`\``),
  ).toEqual({
    actions: [
      { tool: "apply_code" },
      { mode: "update", tool: "save_script" },
      { tool: "close_editor" },
    ],
  });
});

test("extractGeneratePlan ignores unrelated json blocks", () => {
  expect(
    extractGeneratePlan(`\`\`\`json
{"foo":"bar"}
\`\`\`
\`\`\`javascript
// ==UserScript==
\`\`\``),
  ).toBeNull();
});

test("extractGeneratedCode returns only the javascript block", () => {
  expect(
    extractGeneratedCode(`\`\`\`json
{"tool":"apply_code","save":false}
\`\`\`
\`\`\`javascript
// ==UserScript==
// ==/UserScript==
\`\`\``),
  ).toBe(`// ==UserScript==
// ==/UserScript==
`);
});

test("extractGeneratedCode falls back to the unlabeled code block after the plan block", () => {
  expect(
    extractGeneratedCode(`\`\`\`json
{"actions":[{"tool":"apply_code"}]}
\`\`\`
\`\`\`
// ==UserScript==
// ==/UserScript==
\`\`\``),
  ).toBe(`// ==UserScript==
// ==/UserScript==
`);
});

test("extractGeneratedCode handles CRLF fenced blocks", () => {
  expect(
    extractGeneratedCode(
      "```json\r\n{\"actions\":[{\"tool\":\"apply_code\"}]}\r\n```\r\n```javascript\r\n// ==UserScript==\r\n// ==/UserScript==\r\n```",
    ),
  ).toBe(`// ==UserScript==
// ==/UserScript==
`);
});
