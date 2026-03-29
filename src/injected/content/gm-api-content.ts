import bridge, { addBackgroundHandlers, addHandlers, grantless } from "./bridge";
import { addNonceAttribute } from "./inject";
import { decodeResource, elemByTag, makeElem, nextTask, sendCmd } from "./util";
const menus = createNullObj();
const HEAD_TAGS = ["script", "style", "link", "meta"];
const { toLowerCase } = "";
const { [IDS]: ids } = bridge;
let setPopupThrottle: Promise<unknown> | null | undefined;
let isPopupShown = false;
let grantlessUsage: Record<string, unknown> | undefined;
addBackgroundHandlers(
  {
    async PopupShown(state) {
      await bridge[REIFY];
      isPopupShown = state;
      for (const realm in grantless) {
        bridge.post("GetGrantless", null, realm as VMBridgeMode);
      }
      void sendSetPopup();
    },
  },
  true,
);
addHandlers({
  /** @this {Node} */
  AddElement({ tag, attrs }, realm, nodeRet) {
    const parent =
      this ||
      (safeCall(includes, HEAD_TAGS, safeCall(toLowerCase, `${tag}`)) && elemByTag("head")) ||
      elemByTag("body") ||
      elemByTag("*");
    const el = makeElem(tag, attrs);
    addNonceAttribute(el);
    safeCall(appendChild, parent, el);
    nodeRet[0] = el;
  },
  GetResource({ id, isBlob, key, raw }) {
    if (!raw) raw = bridge.cache[bridge.pathMaps[id]?.[key] || key];
    return raw ? decodeResource(raw, isBlob) : true;
  },
  SetGrantless(data) {
    assign((grantlessUsage ??= createNullObj()), data);
  },
  RegisterMenu({ id, key, val }) {
    (menus[id] || (menus[id] = createNullObj()))[key] = val;
    void sendSetPopup(true);
  },
  UnregisterMenu({ id, key }) {
    delete menus[id]?.[key];
    void sendSetPopup(true);
  },
});
export async function sendSetPopup(isDelayed = false) {
  if (isPopupShown) {
    if (isDelayed) {
      if (setPopupThrottle) return;
      // Preventing flicker in popup when scripts re-register menus
      setPopupThrottle = nextTask();
      await setPopupThrottle;
      setPopupThrottle = null;
    }
    await sendCmd(
      "SetPopup",
      {
        [IDS]: ids,
        [INJECT_INTO]: bridge[INJECT_INTO],
        grantless: grantlessUsage,
        menus,
      },
      undefined,
    );
  }
}
