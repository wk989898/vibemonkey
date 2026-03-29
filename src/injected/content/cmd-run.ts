import bridge, { addHandlers, onScripts } from "./bridge";
import { sendSetPopup } from "./gm-api-content";
import { nextTask, sendCmd } from "./util";
const getPersisted = describeProperty(PageTransitionEvent[PROTO], "persisted").get;
let pending: boolean | Promise<void> = topRenderMode === 2; // wait until reified if pre-rendered
let resolveOnReify: (() => void) | undefined;
let runningIds: string[] = [];
let specialInjectInto: typeof SKIP_SCRIPTS | "off" | undefined;
let sent = false;
onScripts.push(() => {
  addHandlers({
    Run,
  });
  runningIds = [];
  specialInjectInto = undefined;
});
on("pageshow", onShown);
if (pending) {
  safeCall(on, document, "prerenderingchange", onShown.bind(null), {
    once: true,
  });
  bridge[REIFY] = new Promise<void>((resolve) => {
    resolveOnReify = resolve;
  });
}
function onShown(evt: Event) {
  // isTrusted is `unforgeable` per DOM spec
  if (evt.isTrusted) {
    if (!this) {
      topRenderMode = 3;
      sent = bridge[REIFY] = false;
      resolveOnReify?.();
      void report();
      topRenderMode = 4;
    } else if (safeCall(getPersisted, evt)) {
      void report(0, "bfcache");
    }
  }
}
export function Run(id: string, realm?: VMBridgeMode) {
  safePush(runningIds, id);
  bridge[IDS][id] = realm || PAGE;
  if (!pending) pending = report(2);
}
async function report(delay = 0, reset: boolean | "bfcache" = !sent) {
  while (--delay >= 0) await nextTask();
  // not awaiting to clear `pending` immediately
  void sendCmd(
    "Run",
    {
      reset,
      [IDS]: specialInjectInto ?? runningIds,
    },
    undefined,
  );
  void sendSetPopup(!!pending);
  pending = false;
  sent = true;
}
export function finish(injectInto?: typeof SKIP_SCRIPTS | "off") {
  if (pending || sent) return;
  if (injectInto === SKIP_SCRIPTS || injectInto === "off") {
    specialInjectInto = injectInto;
  }
  void report();
}
