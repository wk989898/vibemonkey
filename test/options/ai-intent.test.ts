import { expect, test } from "vitest";
import { inferGeneratePlan, resolveGeneratePlan } from "@/options/views/edit/ai-intent";

test("infers create-and-save for new scripts when the prompt explicitly asks to save", () => {
  expect(inferGeneratePlan("创建一个油猴脚本并保存", { props: { id: null } })).toEqual({
    actions: [{ tool: "apply_code" }, { mode: "create", tool: "save_script" }],
  });
});

test("infers update-and-close for existing scripts when the prompt asks to save and close", () => {
  expect(
    inferGeneratePlan("Refactor this script, save it, and close the editor", {
      props: { id: 12 },
    }),
  ).toEqual({
    actions: [
      { tool: "apply_code" },
      { mode: "update", tool: "save_script" },
      { tool: "close_editor" },
    ],
  });
});

test("infers save-as-new for prompts targeting a separate script copy", () => {
  expect(inferGeneratePlan("把这个脚本另存为新脚本并保存", { props: { id: 12 } })).toEqual({
    actions: [{ tool: "apply_code" }, { mode: "create", tool: "save_script" }],
  });
});

test("falls back to apply-only when save intent is not explicit", () => {
  expect(inferGeneratePlan("创建一个油猴脚本", { props: { id: null } })).toEqual({
    actions: [{ tool: "apply_code" }],
  });
});

test("keeps explicit create save actions so existing scripts can be saved as new scripts", () => {
  expect(
    resolveGeneratePlan(
      { actions: [{ mode: "create", tool: "save_script" }] },
      "save it",
      { props: { id: 12 } },
    ),
  ).toEqual({
    actions: [{ tool: "apply_code" }, { mode: "create", tool: "save_script" }],
  });
});

test("uses prompt inference when the model does not return an action block", () => {
  expect(resolveGeneratePlan(null, "Create a userscript and save it", { props: { id: null } })).toEqual({
    actions: [{ tool: "apply_code" }, { mode: "create", tool: "save_script" }],
  });
});

test("normalizes update_script_settings actions", () => {
  expect(
    resolveGeneratePlan(
      {
        actions: [
          {
            settings: {
              enabled: false,
              injectInto: "content",
              runAt: "document-idle",
              tags: ["Alpha", "beta"],
            },
            tool: "update_script_settings",
          },
        ],
      },
      "disable and retag this script",
      { props: { id: 12 } },
    ),
  ).toEqual({
    actions: [
      { tool: "apply_code" },
      {
        settings: {
          enabled: false,
          injectInto: "content",
          runAt: "document-idle",
          tags: ["Alpha", "beta"],
        },
        tool: "update_script_settings",
      },
    ],
  });
});
