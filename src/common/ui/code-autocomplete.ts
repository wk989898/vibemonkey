import CodeMirror from "codemirror";
import { defaultsEditor, kAutocompleteOnTyping as ID } from "@/common/options-defaults";

const OPTIONS = "options";
const STATE = "state";
export const HINT_OPTIONS = "hintOptions";
const COMPLETE_SINGLE = "completeSingle";
const PICKED = "picked";
const TIMER = "timer";
const getMyState = ({ [STATE]: state }: any) => state[ID] || (state[ID] = {});

const delayedComplete = (cm: any) => {
  const options = cm[OPTIONS];
  const hintOptions = options[HINT_OPTIONS] || (options[HINT_OPTIONS] = {});
  const myState = getMyState(cm);
  hintOptions[COMPLETE_SINGLE] = false;
  myState[TIMER] = 0;
  myState[PICKED] = false;
  cm.execCommand("autocomplete");
  setTimeout(() => {
    hintOptions[COMPLETE_SINGLE] = true;
  });
};

const cancelDelay = (myState: any) => {
  if (myState[TIMER]) {
    clearTimeout(myState[TIMER]);
    myState[TIMER] = 0;
  }
};

const onChanges = (cm: any, [info]: any[]) => {
  const myState = getMyState(cm);
  const lastTyped = info.text[info.text.length - 1];
  if (cm[STATE].completionActive || (info.origin && !info.origin.includes("input")) || !lastTyped) {
    return;
  }
  if (myState[PICKED]) {
    myState[PICKED] = false;
    return;
  }
  if (/[-a-z!]$/i.test(lastTyped)) {
    cancelDelay(myState);
    myState[TIMER] = setTimeout(delayedComplete, cm[OPTIONS][ID], cm);
  }
};

const onPicked = (cm: any) => {
  getMyState(cm)[PICKED] = true;
};

CodeMirror.defineOption(ID, defaultsEditor[ID], (cm: any, value: any) => {
  const myState = getMyState(cm);
  const onOff = value ? "on" : "off";
  cm[onOff]("changes", onChanges);
  cm[onOff]("pick", onPicked);
  if (myState && !value) {
    cancelDelay(myState);
    delete cm[STATE][ID];
  }
});
