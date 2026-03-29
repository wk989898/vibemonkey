import { reactive } from "vue";
import { loadQuery } from "@/common";
import { showConfirmation } from "@/common/ui";
import { i18n } from "./util";

type VMRouteState = {
  hash?: string;
  pathname?: string;
  paths?: string[];
  query?: StringMap;
  confirmChange?: ((hash: string) => void | Promise<void>) | false;
};

const stack: VMRouteState[] = [];
export const route = reactive<VMRouteState>({});
export const lastRoute = () => stack[stack.length - 1] || {};

updateRoute();

function updateRoute(noConfirm?: boolean) {
  const hash = window.location.hash.slice(1);
  if (noConfirm || !route.confirmChange) {
    const [pathname, search = ""] = hash.split("?");
    Object.assign(route, {
      hash,
      pathname,
      paths: pathname.split("/"),
      query: loadQuery(search),
    });
  } else if (route.hash !== hash) {
    // restore the pinned route
    setRoute(route.hash, false, true);
    route.confirmChange(hash);
  }
}

// popstate should be the first to ensure hashchange listeners see the correct lastRoute
addEventListener("popstate", () => stack.pop());
addEventListener("hashchange", () => updateRoute(), false);

export function setRoute(hash: string, replace?: boolean, noConfirm?: boolean) {
  let hashString = `${hash}`;
  if (hashString[0] !== "#") hashString = `#${hashString}`;
  if (replace) {
    window.history.replaceState("", null, hashString);
  } else {
    stack.push(Object.assign({}, route));
    window.history.pushState("", null, hashString);
  }
  updateRoute(noConfirm);
}

export function getUnloadSentry(onConfirm?: () => void, onCancel?: () => void) {
  async function confirmPopState(hash) {
    if (await showConfirmation(i18n("confirmNotSaved"))) {
      // popstate cannot be prevented so we pin current `route` and display a confirmation
      setRoute(hash, false, true);
      onConfirm?.();
    } else {
      onCancel?.();
    }
  }
  function toggle(state: boolean) {
    const onOff = `${state ? "add" : "remove"}EventListener`;
    window[onOff]("beforeunload", onUnload);
    route.confirmChange = state && confirmPopState;
  }
  return toggle;
}

function onUnload(e: BeforeUnloadEvent) {
  e.preventDefault();
  // modern browser show their own message text
  e.returnValue = i18n("confirmNotSaved");
}
