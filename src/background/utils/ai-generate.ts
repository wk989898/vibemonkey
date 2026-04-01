const CODE_BLOCK_RE = /```(?:([a-z-]+)[ \t]*\r?\n|\r?\n)([\s\S]*?)```/gi;
const JSON_BLOCK_RE = /```json\s*([\s\S]*?)```/gi;

export type AiGeneratePlanAction =
  | {
      tool: "apply_code";
    }
  | {
      settings: {
        description?: string;
        enabled?: boolean;
        injectInto?: "" | "auto" | "content" | "page";
        name?: string;
        runAt?: "" | "document-body" | "document-end" | "document-idle" | "document-start";
        tags?: string[];
      };
      tool: "update_script_settings";
    }
  | {
      mode: "create" | "update";
      tool: "save_script";
    }
  | {
      tool: "close_editor";
    };

export type AiGeneratePlan = {
  actions: AiGeneratePlanAction[];
};

export function extractGeneratedCode(content: string): string {
  const blocks = Array.from(content.matchAll(CODE_BLOCK_RE));
  const preferredBlock =
    blocks.find((match) => {
      const language = `${match[1] || ""}`.toLowerCase();
      return language === "javascript" || language === "js";
    }) ||
    [...blocks].reverse().find((match) => {
      const language = `${match[1] || ""}`.toLowerCase();
      return !language;
    }) ||
    null;
  const code = (preferredBlock?.[2] || content || "").trim().replace(/\r\n?/g, "\n");
  return code && !code.endsWith("\n") ? `${code}\n` : code;
}

export function extractGeneratePlan(content: string): AiGeneratePlan | null {
  for (const match of content.matchAll(JSON_BLOCK_RE)) {
    const plan = normalizeGeneratePlan(tryParseJson(match[1]));
    if (plan) {
      return plan;
    }
  }
  return null;
}

function normalizeGeneratePlan(data: unknown): AiGeneratePlan | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const plan = normalizeActionList((data as Record<string, unknown>).actions);
  if (plan) {
    return plan;
  }
  const legacy = normalizeLegacyGenerateAction(data as Record<string, unknown>);
  return legacy ? { actions: legacy } : null;
}

function normalizeActionList(rawActions: unknown): AiGeneratePlan | null {
  if (!Array.isArray(rawActions)) {
    return null;
  }
  const actions = rawActions.map(normalizePlanAction).filter(Boolean);
  return actions.length ? { actions } : null;
}

function normalizePlanAction(data: unknown): AiGeneratePlanAction | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const record = data as Record<string, unknown>;
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
      if (record.mode === "create" || record.mode === "update") {
        return {
          mode: record.mode,
          tool: "save_script",
        };
      }
      return null;
    default:
      return null;
  }
}

function normalizeLegacyGenerateAction(record: Record<string, unknown>) {
  const tool = record.tool;
  if (tool !== "apply_code" && tool !== "create_script" && tool !== "update_current_script") {
    return null;
  }
  const actions: AiGeneratePlanAction[] = [{ tool: "apply_code" }];
  if (record.save && tool !== "apply_code") {
    actions.push({
      mode: tool === "create_script" ? "create" : "update",
      tool: "save_script",
    });
  }
  if (record.close && actions.some((action) => action.tool === "save_script")) {
    actions.push({ tool: "close_editor" });
  }
  return actions;
}

function normalizeSettings(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const settings: Record<string, unknown> = {};
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

function tryParseJson(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
