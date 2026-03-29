import { reactive } from "vue";
import { getScriptsTags, i18n, sendCmdDirectly } from "@/common";
import { route } from "@/common/router";

export * from "./search";

type OptionsStore = {
  route: typeof route;
  batch: Promise<unknown> | boolean | null;
  canRenderScripts: boolean;
  cache?: Record<string, string | Promise<string | null> | null>;
  isHiDPI?: boolean;
  scripts: VMScript[];
  removedScripts: VMScript[];
  loaded: "all" | boolean;
  needRefresh: boolean;
  now: number;
  sync: unknown[];
  title: string | null;
  tags?: string[];
  search?: VMSearchRuleset & {
    value: string;
    error: string | null;
  };
} & Record<string, any>;

export const store = reactive<OptionsStore>({
  route,
  batch: null,
  /** Speedup and deflicker initial page load by not rendering an invisible script list */
  canRenderScripts: [SCRIPTS, TAB_RECYCLE, ""].includes(route.hash),
  scripts: [],
  removedScripts: [],
  /** @type {'all' | boolean} */
  loaded: false,
  /** Whether removed scripts need to be filtered from `store.scripts`. */
  needRefresh: false,
  now: Date.now(),
  sync: [],
  title: null,
});

export const kInclude = "include";
export const kMatch = "match";
export const kExclude = "exclude";
export const kExcludeMatch = "excludeMatch";
export const kDescription = "description";
export const kDownloadURL = "downloadURL";
export const kHomepageURL = "homepageURL";
export const kIcon = "icon";
export const kName = "name";
export const kOrigExclude = "origExclude";
export const kOrigExcludeMatch = "origExcludeMatch";
export const kOrigInclude = "origInclude";
export const kOrigMatch = "origMatch";
export const kStorageSize = "storageSize";
export const kUpdateURL = "updateURL";
export const TOGGLE_ON = "toggle-on";
export const TOGGLE_OFF = "toggle-off";

// Same order as getSizes and sizesPrefixRe
export const SIZE_TITLES = [
  i18n("editNavCode"),
  i18n("editNavSettings"),
  i18n("editNavValues"),
  "@require",
  "@resource",
];
export const formatSizesStr = (str: string) =>
  str
    .slice(0, -1) // drop space
    .replace(/\x20/g, "\xA0") // prevent wrapping for big space-separated numbers
    .replace(/[^B]$/gm, "$&B"); // add B to units e.g.g M -> MB

export let K_SAVE; // deduced from the current CodeMirror keymap

export function inferSaveHotKey(hotkeys: Array<[string, string]>) {
  K_SAVE = hotkeys.find(([, cmd]) => cmd === "save")?.[0];
  if (!K_SAVE) {
    K_SAVE = "Ctrl-S";
    hotkeys.unshift([K_SAVE, "save"]);
  }
}

export function markRemove(script: VMScript, removed: boolean) {
  return sendCmdDirectly("MarkRemoved", {
    id: script.props.id,
    removed,
  });
}

export async function runInBatch(
  fn: (...args: any[]) => Promise<unknown> | boolean | void,
  ...args: any[]
) {
  try {
    const result = fn(...args);
    store.batch = (result || true) as OptionsStore["batch"];
    await store.batch;
  } finally {
    store.batch = false;
  }
}

export function setLocationHash(hash: string) {
  location.hash = hash || "";
}

export function toggleBoolean(event: Event) {
  const el = event.target as HTMLTextAreaElement | null;
  if (!el) return;
  const { selectionStart: start, selectionEnd: end, value } = el;
  // Ignoring double-clicks outside of <textarea>
  const toggled = end && { false: "true", true: "false" }[value.slice(start, end)];
  // FF can't run execCommand on textarea, https://bugzil.la/1220696#c24
  if (toggled && !document.execCommand("insertText", false, toggled)) {
    el.value = value.slice(0, start) + toggled + value.slice(end);
    el.setSelectionRange(start + toggled.length, start + toggled.length);
    el.dispatchEvent(new Event("input"));
    el.onblur = () => el.dispatchEvent(new Event("change"));
  }
}

export async function updateTags() {
  store.tags =
    store.loaded !== "all"
      ? ((await sendCmdDirectly("GetTags", null)) as string[])
      : (getScriptsTags(store.scripts) as string[]);
}
