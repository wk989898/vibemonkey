import {
  promptRequestsClose,
  promptRequestsNewScript,
  promptRequestsSave,
} from "@/common/ai-script-intent";

export type GenerateSaveMode = "create" | "update";

export type GeneratePlanAction =
  | {
      tool: "apply_code";
    }
  | {
      settings: GeneratePlanSettings;
      tool: "update_script_settings";
    }
  | {
      mode: GenerateSaveMode;
      tool: "save_script";
    }
  | {
      tool: "close_editor";
    };

export type GeneratePlanSettings = {
  description?: string;
  enabled?: boolean;
  injectInto?: "" | "auto" | "content" | "page";
  name?: string;
  runAt?: "" | "document-body" | "document-end" | "document-idle" | "document-start";
  tags?: string[];
};

export type GeneratePlan = {
  actions: GeneratePlanAction[];
};

type ScriptRef = {
  props?: {
    id?: number | null;
  } | null;
} | null;

export function inferGeneratePlan(prompt: string, script: ScriptRef): GeneratePlan {
  if (!promptRequestsSave(prompt)) {
    return {
      actions: [{ tool: "apply_code" }],
    };
  }
  return buildGeneratePlan(
    !script?.props?.id || promptRequestsNewScript(prompt) ? "create" : "update",
    promptRequestsClose(prompt),
  );
}

export function resolveGeneratePlan(
  plan: Partial<GeneratePlan> | null | undefined,
  prompt: string,
  script: ScriptRef,
): GeneratePlan {
  const fallback = inferGeneratePlan(prompt, script);
  const fallbackSaveMode = getPlanSaveMode(fallback);
  const fallbackClose = hasPlanTool(fallback, "close_editor");
  const normalizedActions = Array.isArray(plan?.actions)
    ? plan.actions.map((item) => normalizePlanAction(item, script)).filter(Boolean)
    : [];
  const extraActions = normalizedActions.filter((action) => action.tool === "update_script_settings");
  const modelSaveMode = getPlanSaveModeFromActions(normalizedActions);
  const saveMode = modelSaveMode || fallbackSaveMode;
  const shouldClose =
    !!saveMode && (hasPlanToolFromActions(normalizedActions, "close_editor") || fallbackClose);
  return buildGeneratePlan(saveMode, shouldClose, extraActions);
}

function buildGeneratePlan(
  saveMode: GenerateSaveMode | null,
  shouldClose: boolean,
  extraActions: GeneratePlanAction[] = [],
): GeneratePlan {
  const actions: GeneratePlanAction[] = [{ tool: "apply_code" }, ...extraActions];
  if (saveMode) {
    actions.push({
      mode: saveMode,
      tool: "save_script",
    });
    if (shouldClose) {
      actions.push({ tool: "close_editor" });
    }
  }
  return { actions };
}

function normalizePlanAction(action: unknown, script: ScriptRef): GeneratePlanAction | null {
  if (!action || typeof action !== "object") {
    return null;
  }
  const record = action as Record<string, unknown>;
  switch (record.tool) {
    case "apply_code":
      return { tool: "apply_code" };
    case "close_editor":
      return { tool: "close_editor" };
    case "update_script_settings": {
      const settings = normalizeSettings(record.settings);
      return settings
        ? {
            settings,
            tool: "update_script_settings",
          }
        : null;
    }
    case "save_script":
      return {
        mode: normalizeSaveMode(record.mode, script),
        tool: "save_script",
      };
    default:
      return null;
  }
}

function normalizeSaveMode(mode: unknown, script: ScriptRef): GenerateSaveMode {
  if (mode === "create") {
    return "create";
  }
  if (mode === "update") {
    return script?.props?.id ? "update" : "create";
  }
  return script?.props?.id ? "update" : "create";
}

function normalizeSettings(raw: unknown): GeneratePlanSettings | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const settings: GeneratePlanSettings = {};
  if (typeof record.enabled === "boolean") {
    settings.enabled = record.enabled;
  }
  if (typeof record.name === "string") {
    settings.name = record.name.trim();
  }
  if (typeof record.description === "string") {
    settings.description = record.description.trim();
  }
  if (Array.isArray(record.tags)) {
    settings.tags = record.tags
      .map((tag) => `${tag || ""}`.trim())
      .filter(Boolean);
  }
  if (
    record.runAt === "" ||
    record.runAt === "document-start" ||
    record.runAt === "document-body" ||
    record.runAt === "document-end" ||
    record.runAt === "document-idle"
  ) {
    settings.runAt = record.runAt;
  }
  if (
    record.injectInto === "" ||
    record.injectInto === "auto" ||
    record.injectInto === "content" ||
    record.injectInto === "page"
  ) {
    settings.injectInto = record.injectInto;
  }
  return Object.keys(settings).length ? settings : null;
}

function getPlanSaveMode(plan: GeneratePlan) {
  return getPlanSaveModeFromActions(plan.actions);
}

function getPlanSaveModeFromActions(actions: (GeneratePlanAction | null)[]) {
  let mode: GenerateSaveMode | null = null;
  actions.forEach((action) => {
    if (action?.tool === "save_script") {
      mode = action.mode;
    }
  });
  return mode;
}

function hasPlanTool(plan: GeneratePlan, tool: GeneratePlanAction["tool"]) {
  return hasPlanToolFromActions(plan.actions, tool);
}

function hasPlanToolFromActions(
  actions: (GeneratePlanAction | null)[],
  tool: GeneratePlanAction["tool"],
) {
  return actions.some((action) => action?.tool === tool);
}
