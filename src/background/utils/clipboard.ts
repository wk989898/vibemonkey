import { addPublicCommands } from "./init";

type ClipboardPayload = {
  data?: string;
  type?: string;
};

const textarea = typeof document !== "undefined" ? document.createElement("textarea") : null;
let clipboardData: ClipboardPayload = {};

addPublicCommands({
  async SetClipboard(data: ClipboardPayload = {}) {
    clipboardData = data;
    if (!textarea) {
      if (data?.type && data.type !== "text/plain") {
        throw new SafeError(
          "Clipboard formats other than text/plain are unavailable in the background worker.",
        );
      }
      if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(data?.data || "");
      }
      throw new SafeError("Clipboard API unavailable in the background worker.");
    }
    textarea.focus();
    const ret = document.execCommand("copy", false, null);
    if (!ret && process.env.DEBUG) {
      console.warn("Copy failed!");
    }
  },
});

if (textarea) {
  document.body?.appendChild(textarea);

  addEventListener("copy", (e: ClipboardEvent) => {
    e.preventDefault();
    const { type, data } = clipboardData;
    e.clipboardData?.setData(type || "text/plain", data || "");
  });
}
