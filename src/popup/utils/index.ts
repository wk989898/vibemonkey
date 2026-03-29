import { reactive } from "vue";
import { isTouch } from "@/common/ui";

type PopupStore = ReturnType<typeof emptyStore> & {
  cache?: Record<string, string | Promise<string | null> | null>;
  isHiDPI?: boolean;
} & Record<string, any>;

export const emptyStore = () => ({
  scripts: [],
  frameScripts: [],
  idMap: {},
  commands: {},
  domain: "",
  injectionFailure: null,
  injectable: true,
});

export const isFullscreenPopup =
  isTouch && innerWidth > screen.availWidth - 200 && innerHeight > screen.availHeight - 200;

export const store = reactive<PopupStore>(emptyStore() as PopupStore);
