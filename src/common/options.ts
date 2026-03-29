import defaults from "@/common/options-defaults";
import { initHooks, sendCmdDirectly } from ".";
import { forEachEntry, objectGet, objectSet } from "./object";

type OptionsData = Record<string, any>;

const options: OptionsData = {};
const { hook, fire } = initHooks<[OptionsData]>();
const ready = sendCmdDirectly("GetAllOptions", null, { retry: true }).then((data) => {
  Object.assign(options, data);
  if (data) fire(data);
});

export default {
  ready,
  hook,
  get(key?: string) {
    return key
      ? (objectGet(options, key) ?? objectGet(defaults, key))
      : { ...defaults, ...options };
  },
  set(key: string, value: unknown) {
    // the updated options object will be propagated from the background script after a pause
    // so meanwhile the local code should be able to see the new value using options.get()
    objectSet(options, key, value);
    return sendCmdDirectly("SetOptions", { [key]: value });
  },
  update(data: OptionsData) {
    // Keys in `data` may be { flattened.like.this: 'foo' }
    const expandedData: OptionsData = {};
    forEachEntry.call(data, ([key, value]) => {
      objectSet(options, key, value);
      objectSet(expandedData, key, value);
    });
    fire(expandedData);
  },
};
