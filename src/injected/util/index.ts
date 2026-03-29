/* WARNING!
 * Make sure all re-exported functions survive in a spoofed/broken environment:
 * use only explicit safe globals initialized in a corresponding safe-globals* file,
 * use __proto__:null or get/set own props explicitly. */

export { dumpScriptValue, isEmpty } from "@/common";
export * from "@/common/consts";
export const CONSOLE_METHODS = ["log", "info", "warn", ERROR, "debug"];
export const addErrorStack = (err, localErr) => {
  err.stack += "\n-----------\n" + localErr.stack;
  return err;
};
export const fireBridgeEvent = (eventId, msg) => {
  const detail = cloneInto ? cloneInto(msg, document) : msg;
  const evtMain = new SafeCustomEvent(eventId, {
    __proto__: null,
    detail,
  } as CustomEventInit);
  safeCall(fire, window, evtMain);
};
export const bindEvents = (srcId, destId, bridge) => {
  /* Using a separate event for `node` because CustomEvent can't transfer nodes,
   * whereas MouseEvent (and some others) can't transfer objects without stringification. */
  let incomingNodeEvent;
  safeCall(
    on,
    window,
    srcId,
    (e) => {
      safeCall(stopImmediatePropagation, e);
      if (process.env.DEBUG) {
        console.info(
          `[bridge.${bridge[IDS] ? "host" : "guest.web"}] received`,
          incomingNodeEvent ? safeCall(getRelatedTarget, e) : safeCall(getDetail, e),
        );
      }
      if (!incomingNodeEvent) {
        // CustomEvent is the main message
        // but if the previous message was non-cloneable we will throw if MouseEvent is next
        try {
          e = safeCall(getDetail, e);
        } catch (err) {
          return;
        }
        if (!e) {
          e = createNullObj();
          e.data = `[${VIOLENTMONKEY}] Non-cloneable property e.g. a DOM node or function.`;
        }
        if (cloneInto) e = cloneInto(e, window);
        if (e.node && (incomingNodeEvent = e)) return;
      } else {
        // MouseEvent is the second event when the main event has `node: true`
        incomingNodeEvent.node = safeCall(getRelatedTarget, e);
        e = incomingNodeEvent;
        incomingNodeEvent = null; // must precede onHandle() to handle nested incoming event
      }
      bridge.onHandle(e);
    },
    true,
  );
  /** In Content bridge `pageNode` is `realm` which is wired in setupContentInvoker */
  bridge.post = (cmd, data, pageNode, contNode) => {
    const node = bridge[IDS] ? contNode : pageNode;
    // Constructing the event now so we don't send anything if it throws on invalid `node`
    const evtNode =
      node &&
      new SafeMouseEvent(destId, {
        __proto__: null,
        relatedTarget: node,
      } as MouseEventInit);
    fireBridgeEvent(destId, {
      cmd,
      data,
      node: !!evtNode,
    });
    if (evtNode) safeCall(fire, window, evtNode);
  };
};
