import {
  createApp,
  h,
  type App as VueApp,
  type Component,
  type Directive,
  type DirectiveBinding,
} from "vue";
import Modal from "vueleton/lib/modal";
import { trueJoin } from "@/common";
import { i18n } from "@/common/util";
import { VM_HOME } from "@/common/consts";
import Message from "./message.vue";

type MessageButton = {
  text: string;
  type?: "button" | "submit" | "reset";
  onClick?: (value?: string | boolean) => unknown;
} & Record<string, unknown>;

export type MessageConfig = {
  text: string;
  desc?: string;
  input?: string | false;
  timeout?: number;
  buttons?: MessageButton[];
  onBackdropClick?: () => unknown;
  onDismiss?: () => void;
};

type ConfirmationButtonConfig = (Partial<MessageButton> & Record<string, unknown>) | false;

type ConfirmationBaseConfig = {
  ok?: ConfirmationButtonConfig;
  cancel?: ConfirmationButtonConfig;
};

type ConfirmationTextConfig = ConfirmationBaseConfig & {
  input?: false;
};

type ConfirmationInputConfig = ConfirmationBaseConfig & {
  input: string;
};

type FocusBinding = DirectiveBinding<boolean | null | undefined>;

/** Showing unexpected errors in UI so that the users can notify us */
addEventListener(ERROR, (e) => showUnhandledError(e.error));
addEventListener("unhandledrejection", (e) => showUnhandledError(e.reason));

export function showUnhandledError(err: unknown): void {
  if (!err) return;
  const id = "unhandledError";
  const fontSize = 10;
  const existingElement = document.getElementById(id);
  const el =
    existingElement instanceof HTMLTextAreaElement
      ? existingElement
      : document.createElement("textarea");
  const errorLike = err as Partial<Error> & { stack?: string; message?: string };
  const text = [
    el.value,
    isObject(err)
      ? `${(IS_FIREFOX && errorLike.message) || ""}\n${errorLike.stack || ""}`
      : `${err}`,
  ];
  const normalizedText = trueJoin.call(text, "\n\n");
  el.value = normalizedText.trim().split(extensionRoot).join("");
  const textValue = el.value;
  const height = `${fontSize * (calcRows(textValue) + 1)}px`;
  const parent = document.body || document.documentElement;
  el.id = id;
  el.readOnly = true;
  // Use inline styles because our stylesheet may not be ready this early.
  el.style.cssText = `\
    position:fixed;
    z-index:${1e9};
    left:0;
    right:0;
    bottom:0;
    background:#000;
    color:red;
    padding: ${fontSize / 2}px;
    font-size: ${fontSize}px;
    line-height: 1;
    box-sizing: border-box;
    height: ${height};
    border: none;
    resize: none;
  `.replace(/;/g, "!important;");
  el.spellcheck = false;
  el.onclick = () => el.select();
  parent.style.minHeight = height;
  parent.appendChild(el);
}

export function showMessage(message: MessageConfig): void {
  const modal = Modal.show(
    () =>
      h(Message, {
        message,
        onDismiss() {
          modal.close();
          message.onDismiss?.();
        },
      }),
    {
      transition: "in-out",
    },
  );
  if (!message.buttons) {
    const timer = setInterval(() => {
      if (!document.querySelector(".vl-modal .modal-content:hover")) {
        clearInterval(timer);
        modal.close();
      }
    }, message.timeout || 2000);
  }
}

export function showConfirmation(text: string, config?: ConfirmationTextConfig): Promise<boolean>;
export function showConfirmation(
  text: string,
  config: ConfirmationInputConfig,
): Promise<string | null>;
export function showConfirmation(
  text: string,
  config: ConfirmationTextConfig | ConfirmationInputConfig = {},
): Promise<boolean | string | null> {
  return new Promise((resolve) => {
    const { ok, cancel, input = false } = config;
    const hasInput = input !== false;
    const onCancel = () => resolve(hasInput ? null : false);
    const onOk = (val?: string | boolean) => {
      resolve(hasInput ? (typeof val === "string" ? val : "") : true);
    };
    const buttons: MessageButton[] = [];
    if (ok !== false) {
      buttons.push({ text: i18n("buttonOK"), onClick: onOk, ...ok });
    }
    if (cancel !== false) {
      buttons.push({ text: i18n("buttonCancel"), onClick: onCancel, ...cancel });
    }
    showMessage({
      input,
      text,
      buttons,
      onBackdropClick: onCancel,
      onDismiss: onCancel,
    });
  });
}

/** Number of lines + 1 if the last line is not empty. */
export function calcRows(val: string): number {
  if (!val) return 0;
  return (val.match(/$/gm)?.length ?? 0) + Number(!val.endsWith("\n"));
}

export function render(App: Component, el?: Element | string | null): VueApp {
  const app = createApp(App);
  Object.assign(app.config.globalProperties, {
    i18n,
    calcRows,
  });
  if (!el) {
    el = document.createElement("div");
    document.body.append(el);
  }
  app.mount(el);
  return app;
}

/**
 * Focuses the first element with `focusme` attribute or root, which enables keyboard scrolling.
 * Not using `autofocus` to avoid warnings in console on page load.
 * A child component should use nextTick to change focus, which runs later.
 */
export function focusMe(el: HTMLElement): void {
  const target = el.querySelector<HTMLElement>("[focusme]") || el;
  target.tabIndex = -1;
  target.focus();
}

function vFocusFactory(): Directive<HTMLElement, boolean | null | undefined> {
  const handle = (
    el: HTMLElement,
    value: FocusBinding["value"],
    oldValue: FocusBinding["oldValue"],
  ) => {
    if (value === oldValue) return;
    if (value == null || value) {
      el.tabIndex = -1;
      el.focus();
    }
  };
  return {
    mounted(el: HTMLElement, binding: FocusBinding) {
      handle(el, binding.value, undefined);
    },
    updated(el: HTMLElement, binding: FocusBinding) {
      handle(el, binding.value, binding.oldValue);
    },
  };
}

export const vFocus = vFocusFactory();
export const isTouch = "ontouchstart" in document;
export const getActiveElement = () => document.activeElement;
export const hasKeyModifiers = (e: MouseEvent | KeyboardEvent): boolean =>
  e.shiftKey || e.ctrlKey || e.metaKey || e.altKey;
export const externalEditorInfoUrl =
  VM_HOME + "posts/how-to-edit-scripts-with-your-favorite-editor/";
export const EXTERNAL_LINK_PROPS = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;

const { getAsFileSystemHandle } = DataTransferItem.prototype;

if (getAsFileSystemHandle) {
  const getItem = (evt: DragEvent): DataTransferItem | undefined =>
    evt.dataTransfer?.items
      ? (Array.prototype.find.call(
          evt.dataTransfer.items,
          (item: DataTransferItem) => item.type === "text/javascript",
        ) as DataTransferItem | undefined)
      : undefined;

  addEventListener(
    "dragover",
    (evt) => {
      if (getItem(evt)) evt.preventDefault();
    },
    true,
  );

  addEventListener(
    "drop",
    async (evt) => {
      const item = getItem(evt);
      if (!item) return;
      evt.preventDefault();
      evt.stopPropagation();
      const path = "/confirm/index.html";
      const url = evt.dataTransfer?.getData("text") || undefined;
      const handle = await getAsFileSystemHandle.call(item);
      const isNewWindow = hasKeyModifiers(evt) || location.pathname !== path;
      const wnd = isNewWindow ? window.open(path) || window : window;
      const cloneHandle =
        isNewWindow && typeof wnd.structuredClone === "function"
          ? wnd.structuredClone(handle)
          : handle;
      const transferredHandle = cloneHandle as FileSystemHandleWithUrl;
      transferredHandle._url = url;
      wnd.fsh = transferredHandle;
    },
    true,
  );
}
