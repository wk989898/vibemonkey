import browser from "@/common/browser";
import { sendCmd } from "./content/util";
import { USERSCRIPT_META_INTRO } from "./util";
import "./content";
const isUserScriptUrl = topRenderMode === 1 && location.pathname.endsWith(".user.js");
const isChromeMv3 = !IS_FIREFOX && browser.runtime.getManifest().manifest_version === 3;
const canSelfInstall =
  isUserScriptUrl &&
  (isChromeMv3 ||
    (IS_FIREFOX &&
      location.protocol === "file:" &&
      document.contentType === "application/x-javascript")); // FF uses this for file: scheme

// Script installation in Firefox as it does not support `onBeforeRequest` for `file:`
// Chrome MV3 no longer supports blocking `webRequest`, so we self-install in the page instead.
// Using pathname and a case-sensitive check to match webRequest `urls` filter behavior.
if (canSelfInstall) {
  (async () => {
    const { fetch, history } = global;
    const { referrer } = document;
    const { text: getText } = ResponseProto;
    const isFirefoxFile = IS_FIREFOX && location.protocol === "file:";
    const isFF68 = "cookie" in Document[PROTO];
    const url = location.href;
    const fetchCode = async () =>
      safeCall(
        getText,
        await fetch(url, {
          mode: "same-origin",
        }),
      );
    let code = await fetchCode();
    let busy;
    let oldCode;
    if (safeCall(stringIndexOf, code, USERSCRIPT_META_INTRO) < 0) {
      return;
    }
    await sendCmd(
      "ConfirmInstall",
      {
        code,
        url,
        from: referrer,
      },
      undefined,
    );
    // FF68+ doesn't allow extension pages to get file: URLs anymore so we need to track it here
    // (detecting FF68 by a feature because we can't use getBrowserInfo here and UA may be altered)
    if (isFirefoxFile && isFF68) {
      /** @param {chrome.runtime.Port} */
      browser.runtime.onConnect.addListener((port) => {
        if (port.name !== "FetchSelf") return;
        port.onMessage.addListener(async () => {
          try {
            if (busy) await busy;
            code = await (busy = fetchCode());
          } finally {
            busy = false;
          }
          if (code === oldCode) {
            code = null;
          } else {
            oldCode = code;
          }
          port.postMessage(code);
        });
        port.onDisconnect.addListener(async () => {
          oldCode = null;
          // The user may have reloaded the Confirm page so let's check
          if (!(await sendCmd("CheckInstallerTab", port.sender.tab.id, undefined))) {
            closeSelf();
          }
        });
      });
    } else if (!isChromeMv3) {
      closeSelf();
    }
    function closeSelf() {
      if (history.length > 1) {
        history.go(-1);
      } else {
        sendCmd("TabClose", undefined, undefined);
      }
    }
  })().catch(logging.error); // FF doesn't show exceptions in content scripts
}
