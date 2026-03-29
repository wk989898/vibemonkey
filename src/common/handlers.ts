import { showUnhandledError } from "@/common/ui";
import options from "./options";

type HandlerFn = (data?: unknown, src?: HandlerSource) => boolean | void | Promise<unknown>;

type HandlerMessage = {
  cmd?: keyof typeof handlers;
  data?: unknown;
  url?: string;
};

type HandlerSource = browser.runtime.MessageSender & {
  url?: string;
};

const handlers: Record<string, HandlerFn> = {
  __proto__: null,
  Reload(delay?: number) {
    setTimeout(() => location.reload(), delay);
  },
  UpdateOptions(data: unknown) {
    options.update(data);
  },
};

browser.runtime.onMessage.addListener((res: HandlerMessage, src: HandlerSource) => {
  const handle = handlers[res.cmd];
  if (handle) {
    src.url = res.url || src.url; // MessageSender.url doesn't change on soft navigation
    const result = handle(res.data, src);
    if (result instanceof Promise) result.catch(showUnhandledError);
    return result;
  }
});

export default handlers;
