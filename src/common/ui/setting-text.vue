<template>
  <div class="setting-text">
    <textarea
      ref="$text"
      class="monospace-font"
      :class="{ 'has-error': error }"
      spellcheck="false"
      v-model="text"
      :disabled
      :placeholder
      :rows="rows || calcRows(text)"
      @ctrl-s="onSave"
    />
    <button
      v-if="hasSave"
      v-text="saved || i18n('buttonSave')"
      @click="onSave"
      :title="ctrlS"
      :disabled="disabled || !canSave"
    />
    <button
      v-if="hasReset"
      v-text="i18n('buttonReset')"
      @click="onReset"
      :disabled="disabled || !canReset"
    />
    <!-- DANGER! Keep the error tag in one line to keep the space which ensures the first word
         is selected correctly without the preceding button's text on double-click. -->
    <slot />
    <template v-if="error">
      <span v-if="typeof error === 'string'" class="error text-red sep" v-text="error" />
      <ol v-else class="text-red">
        <li v-for="e in error" :key="e" v-text="e" />
      </ol>
    </template>
  </div>
</template>

<script lang="ts">
import { CTRL_META } from "@/common/ui/util";

const ctrlS = CTRL_META + "S";
/** XXX compatible with old data format */
const handleArray = (val: unknown) => (Array.isArray(val) ? val.join("\n") : `${val || ""}`);
const handleJSON = (val: unknown) => JSON.stringify(val, null, "  ");
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { i18n } from "@/common";
import { getUnloadSentry } from "@/common/router";
import { deepEqual, objectGet } from "../object";
import options from "../options";
import defaults from "../options-defaults";
import hookSetting from "../hook-setting";
import { normalizeBgError } from "./setting-text-errors";

let savedValue: unknown;
let savedValueText = "";

const props = withDefaults(
  defineProps<{
    name: string;
    json?: boolean;
    disabled?: boolean;
    getErrors?: () => unknown | Promise<unknown>;
    hasSave?: boolean;
    hasReset?: boolean;
    rows?: number;
  }>(),
  {
    hasSave: true,
  },
);
const emit = defineEmits<{
  save: [];
}>();
const $text = ref<HTMLTextAreaElement | null>(null);
const canSave = ref(false);
const canReset = ref(false);
const error = ref<string | string[] | null>(null);
const isDirty = ref(false);
const saved = ref("");
const text = ref("");
const value = ref<unknown>();

const handle = props.json ? handleJSON : handleArray;
const defaultValue = objectGet(defaults, props.name);
const placeholder = handle(defaultValue);
const toggleUnloadSentry = getUnloadSentry(() => {
  /* Reset to saved value after confirming loss of data.
     The component won't be destroyed on tab change, so the changes are actually kept.
     Here we reset it to make sure the user loses the changes when leaving the settings tab.
     Otherwise the user may be confused about where the changes are after switching back. */
  text.value = handle(savedValue);
});
const revoke = hookSetting(props.name, (val) => {
  savedValue = val;
  text.value = savedValueText = handle(val);
});

defineExpose({
  defaultValue,
  text,
  value,
});
watch(isDirty, toggleUnloadSentry);
watch(text, (str) => {
  let isSavedValueText = false;
  let val: unknown;
  let err: string | undefined;
  if (props.json) {
    try {
      isSavedValueText = str === savedValueText;
      val = isSavedValueText ? savedValue : JSON.parse(str);
    } catch (e) {
      err = (e as Error).message;
    }
    error.value = err;
  } else {
    val = str;
  }
  value.value = val;
  saved.value = "";
  canReset.value = !deepEqual(val, defaultValue || "");
  isDirty.value = !isSavedValueText && !deepEqual(val, savedValue || "");
  canSave.value = isDirty.value && !err;
  if (canSave.value && !props.hasSave) onSave(); // Auto save if there is no `Save` button
});
onMounted(async () => {
  const errors = await props.getErrors?.();
  error.value = Array.isArray(errors) ? (errors as string[]) : (errors as string | null);
});
onBeforeUnmount(() => {
  revoke();
  toggleUnloadSentry(false);
});

function onSave() {
  options.set(props.name, (savedValue = value.value)).then(bgError, bgError);
  savedValueText = text.value;
  isDirty.value = canSave.value = false;
  saved.value = i18n("buttonSaved");
  emit("save");
}
function onReset() {
  const el = $text.value;
  /* Focusing to allow quick Ctrl-Z to undo.
   * Focusing also prevents layout shift when `reset` button auto-hides. */
  el.focus();
  if (!props.hasSave) {
    // No save button = something rather trivial e.g. the export file name
    options.set(props.name, defaultValue).then(bgError, bgError);
  } else {
    // Save button exists = let the user undo the input
    el.select();
    if (!document.execCommand("insertText", false, placeholder)) {
      text.value = placeholder;
    }
  }
}
function bgError(err?: unknown) {
  error.value = normalizeBgError(err);
}
</script>

<style>
.setting-text {
  > .error {
    /* We've used .sep so our error text aligns with the buttons, now we need to undo some parts */
    display: inline;
    &::after {
      content: none;
    }
  }
}
</style>
