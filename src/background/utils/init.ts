type CommandHandler = ((...args: any[]) => any) & {
  isOwn?: boolean;
};

type CommandMap = Record<string, CommandHandler>;

type InitPromise = Promise<void> & {
  deps: Promise<unknown>[];
};

export const commands: CommandMap = {};
export const addPublicCommands = (obj: CommandMap) => Object.assign(commands, obj);
/** Commands that can be used only by an extension page i.e. not by a content script */
export const addOwnCommands = (obj: CommandMap) => {
  for (const key in obj) {
    (commands[key] = obj[key]).isOwn = true;
  }
};

export let resolveInit: () => Promise<void>;
export let init: InitPromise | null = new Promise<void>((resolve) => {
  resolveInit = () => Promise.all(init?.deps || []).then(() => resolve());
}) as InitPromise;
init.deps = [];
init.then(() => {
  init = null;
});
