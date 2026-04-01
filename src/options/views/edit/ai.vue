<template>
  <div class="ai-assistant shelf mr-2c flex flex-col">
    <div class="flex ai-assistant__header">
      <strong>AI Assistant</strong>
      <span class="ml-1 subtle">
        Generates code into the editor. It auto-saves only when you explicitly ask it to save.
      </span>
    </div>
    <textarea
      v-model="prompt"
      class="monospace-font"
      :disabled="disabled || loading"
      rows="5"
      placeholder="Describe the userscript you want, or ask to refactor the current code."
    />
    <div class="flex ai-assistant__actions">
      <button
        v-text="loading ? 'Generating...' : 'Generate Into Editor'"
        :disabled="disabled || loading || !prompt.trim()"
        @click="generate"
      />
      <span v-if="status" class="subtle ml-1" v-text="status" />
    </div>
    <pre v-if="preview" class="ai-assistant__preview monospace-font" v-text="preview" />
    <p v-if="error" class="text-red mt-1" v-text="error" />
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { getUniqId, sendCmd } from "@/common";
import { AI_STREAM_EVENT, type AiStreamPayload } from "@/common/ai-stream";
import handlers from "@/common/handlers";
import {
  resolveGeneratePlan,
  type GeneratePlan,
  type GeneratePlanSettings,
  type GenerateSaveMode,
} from "./ai-intent";

type ScriptSummary = {
  id: number | null;
  name: string;
  description: string;
  match: string[];
  include: string[];
  exclude: string[];
  excludeMatch: string[];
  grant: string[];
  enabled: boolean;
};

type GenerateResponse = {
  plan?: Partial<GeneratePlan> | null;
  code: string;
  content: string;
  model: string;
  usage?: {
    total_tokens?: number;
  };
};

const props = defineProps<{
  applyScriptSettings: (settings: GeneratePlanSettings) => void;
  closeEditor: () => void;
  disabled?: boolean;
  getCode: () => string;
  saveCode: (mode: GenerateSaveMode, force?: boolean) => Promise<boolean>;
  script: VMScript;
}>();
const emit = defineEmits<{
  apply: [code: string];
}>();

const prompt = ref("");
const loading = ref(false);
const error = ref("");
const preview = ref("");
const status = ref("");
let activeRequestId = "";
const previousAiStreamHandler = handlers[AI_STREAM_EVENT];
const handleAiStreamEvent = (payload?: AiStreamPayload) => {
  if (`${payload?.requestId || ""}` !== activeRequestId || !payload?.delta) {
    return;
  }
  preview.value += payload.delta;
  status.value = "Streaming reply...";
};
const aiStreamHandler = (payload) => {
  previousAiStreamHandler?.(payload);
  handleAiStreamEvent(payload as AiStreamPayload | undefined);
};

onMounted(() => {
  handlers[AI_STREAM_EVENT] = aiStreamHandler;
});

onBeforeUnmount(() => {
  if (handlers[AI_STREAM_EVENT] === aiStreamHandler) {
    if (previousAiStreamHandler) {
      handlers[AI_STREAM_EVENT] = previousAiStreamHandler;
    } else {
      delete handlers[AI_STREAM_EVENT];
    }
  }
});

async function generate() {
  error.value = "";
  preview.value = "";
  status.value = "";
  loading.value = true;
  activeRequestId = getUniqId("vm-ai-generate-");
  try {
    const res = (await sendCmd("AiGenerateScript", {
      prompt: prompt.value,
      code: props.getCode(),
      requestId: activeRequestId,
      script: buildScriptSummary(props.script),
    })) as GenerateResponse;
    const plan = resolveGeneratePlan(res.plan, prompt.value, props.script);
    const saveMode = getPlanSaveMode(plan);
    emit("apply", res.code);
    const settings = getPlanSettings(plan);
    if (settings) {
      props.applyScriptSettings(settings);
    }
    const tokens = res.usage?.total_tokens
      ? `, ${res.usage.total_tokens.toLocaleString()} tokens`
      : "";
    if (saveMode) {
      await nextTick();
      if (await props.saveCode(saveMode, true)) {
        preview.value = "";
        status.value = getSavedStatus(plan, res.model, tokens);
        if (hasPlanTool(plan, "close_editor")) {
          props.closeEditor();
        }
      } else {
        preview.value = res.code || preview.value;
        error.value ||= "Automatic save failed. Review the generated script and save it manually.";
      }
    } else {
      preview.value = res.code || preview.value;
      status.value = `Applied ${res.model}${tokens}. Review and save when ready.`;
    }
  } catch (err) {
    error.value = err.message || `${err}`;
  } finally {
    activeRequestId = "";
    loading.value = false;
  }
}

function buildScriptSummary(script: VMScript): ScriptSummary {
  const meta = (script.meta || {}) as Partial<VMScript["meta"]>;
  const custom = (script.custom || {}) as Partial<VMScript["custom"] & { description?: string }>;
  const info = (script.props || {}) as Partial<VMScript["props"]>;
  const config = (script.config || {}) as Partial<VMScript["config"]>;
  return {
    id: info.id || null,
    name: custom.name || meta.name || "",
    description: custom.description || meta.description || "",
    match: custom.match || meta.match || [],
    include: custom.include || meta.include || [],
    exclude: custom.exclude || meta.exclude || [],
    excludeMatch: custom.excludeMatch || meta.excludeMatch || [],
    grant: meta.grant || [],
    enabled: !!config.enabled,
  };
}

function getSavedStatus(plan: GeneratePlan, model: string, tokens: string) {
  if (getPlanSaveMode(plan) === "create") {
    return `Created and saved with ${model}${tokens}.`;
  }
  if (hasPlanTool(plan, "close_editor")) {
    return `Saved and closed with ${model}${tokens}.`;
  }
  return `Updated and saved with ${model}${tokens}.`;
}

function getPlanSaveMode(plan: GeneratePlan) {
  const action = plan.actions.find((item) => item.tool === "save_script");
  return action?.mode || null;
}

function hasPlanTool(plan: GeneratePlan, tool: GeneratePlan["actions"][number]["tool"]) {
  return plan.actions.some((item) => item.tool === tool);
}

function getPlanSettings(plan: GeneratePlan) {
  const action = plan.actions.find((item) => item.tool === "update_script_settings");
  return action?.tool === "update_script_settings" ? action.settings : null;
}
</script>

<style>
.ai-assistant {
  gap: 0.5rem;
  &__preview {
    max-height: 16rem;
    margin: 0;
    overflow: auto;
    padding: 0.75rem;
    white-space: pre-wrap;
    word-break: break-word;
    background: rgba(15, 23, 42, 0.04);
    border: 1px solid rgba(15, 23, 42, 0.1);
    border-radius: 0.5rem;
  }
  textarea {
    min-height: 8rem;
    resize: vertical;
  }
  &__header,
  &__actions {
    align-items: center;
  }
}
</style>
