import { i18n, defaultImage, sendTabCmd, trueJoin } from "@/common";
import { addPublicCommands, commands } from "./init";
import { CHROME } from "./ua";
import { vetUrl } from "./url";

type NotificationClickHandler = () => void;
type NotificationTimer = ReturnType<typeof setTimeout>;

type NotificationSource = VMMessageSender & {
  _removed?: boolean;
  zombie?: NotificationTimer;
  zombieTimeout?: number;
  zombieUrl?: string;
};

type NotificationOpener = NotificationClickHandler | NotificationSource | NotificationTimer;

type NotificationPayload = {
  image?: string;
  onclick?: NotificationClickHandler;
  silent?: boolean;
  tag?: string;
  text: string;
  title?: string;
  zombieTimeout?: number;
  zombieUrl?: string;
};

const openers: Record<string, NotificationOpener | undefined> = {};
const kZombie = "zombie";
const kZombieTimeout = "zombieTimeout";
const kZombieUrl = "zombieUrl";

addPublicCommands({
  /** @return {Promise<string>} */
  async Notification(
    {
      image,
      text,
      tag,
      title,
      silent,
      onclick,
      [kZombieUrl]: zombieUrl,
      [kZombieTimeout]: zombieTimeout,
    }: NotificationPayload,
    src?: VMMessageSender,
  ) {
    if (tag) clearZombieTimer(openers[tag]);
    const notificationId = await browser.notifications.create(tag, {
      type: "basic",
      title: trueJoin.call([title, IS_FIREFOX && i18n("extName")], " - "), // Chrome already shows the name
      message: text,
      iconUrl: image || defaultImage || "",
      ...(!IS_FIREFOX && {
        requireInteraction: !!onclick,
      }),
      ...(CHROME >= 70 && {
        silent,
      }),
    });
    if (isFunction(onclick)) {
      openers[notificationId] = onclick;
    } else if (src) {
      const source = src as NotificationSource;
      openers[notificationId] = source;
      if (+zombieTimeout > 0) source[kZombieTimeout] = +zombieTimeout;
      if (zombieUrl != null) source[kZombieUrl] = vetUrl(zombieUrl, source.url);
    }
    return notificationId;
  },
  RemoveNotification(nid: string) {
    clearZombieTimer(openers[nid]);
    removeNotification(nid);
  },
});

browser.notifications.onClicked.addListener((id) => {
  notifyOpener(id, true);
});

browser.notifications.onClosed.addListener((id) => {
  notifyOpener(id, false);
  delete openers[id];
});

function notifyOpener(id: string, isClick: boolean) {
  const op = openers[id];
  if (!op) return;
  if (isFunction(op)) {
    if (isClick) op();
  } else if (isNotificationTimer(op)) {
    if (isClick) clearZombieTimer(op);
  } else if (op[kZombie]) {
    if (isClick) {
      commands.TabOpen({ url: op[kZombieUrl] }, op);
      removeNotification(id); // Chrome doesn't auto-remove it on click
    }
  } else {
    const tabId = op.tab?.id;
    if (tabId == null) return;
    sendTabCmd(tabId, isClick ? "NotificationClick" : "NotificationClose", id, {
      [kFrameId]: op[kFrameId],
    });
  }
}

function isNotificationTimer(op: NotificationOpener): op is NotificationTimer {
  return typeof op === "number" || (isObject(op) && !("tab" in op));
}

export function clearNotifications(tabId: number, frameId?: number, tabRemoved?: boolean) {
  for (const nid in openers) {
    const op = openers[nid];
    const source = isObject(op) ? (op as NotificationSource) : null;
    if (
      source &&
      source.tab?.id === tabId &&
      (!frameId || source[kFrameId] === frameId) &&
      !source[kZombie]
    ) {
      if (source[kZombieTimeout]) {
        source[kZombie] = setTimeout(removeNotification, source[kZombieTimeout], nid);
        if (!source[kZombieUrl]) openers[nid] = source[kZombie];
        if (tabRemoved) source._removed = true;
      } else {
        removeNotification(nid);
      }
    }
  }
}

function clearZombieTimer(op?: NotificationOpener) {
  if (op && isNotificationTimer(op)) {
    clearTimeout(op as NotificationTimer);
  }
}

function removeNotification(nid: string) {
  delete openers[nid];
  return browser.notifications.clear(nid);
}
