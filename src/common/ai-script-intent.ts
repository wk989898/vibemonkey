const AUTO_CLOSE_EN_RE = /\b(?:close|exit)\b/i;
const AUTO_CLOSE_ZH_RE = /(?:关闭|关掉|退出)/;
const AUTO_NEW_SCRIPT_EN_RE =
  /\b(?:new|separate|another|copy|duplicate)\b[\s\S]{0,40}\bscript\b|\bsave as new\b/i;
const AUTO_NEW_SCRIPT_ZH_RE = /(?:另存为新脚本|保存为新脚本|新脚本|副本|复制一份)/;
const AUTO_SAVE_EN_RE = /\b(?:save|install|persist)\b/i;
const AUTO_SAVE_ZH_RE = /(?:保存|另存|存起来|存下|安装|自动保存)/;
const SCRIPT_CREATE_EN_RE =
  /\b(?:create|generate|write|build|make|draft|scaffold)\b[\s\S]{0,80}\b(?:userscript|user script|tampermonkey|violentmonkey|greasemonkey|script)\b|\b(?:userscript|user script|tampermonkey|violentmonkey|greasemonkey|script)\b[\s\S]{0,80}\b(?:create|generate|write|build|make|draft|scaffold)\b/i;
const SCRIPT_CREATE_ZH_RE =
  /(?:创建|生成|写|编写|做(?:一个|个)?|制作).{0,40}(?:油猴|用户脚本|脚本)|(?:油猴|用户脚本|脚本).{0,40}(?:创建|生成|写|编写|做(?:一个|个)?|制作)/;

function normalizePrompt(prompt: string) {
  return `${prompt || ""}`.trim();
}

export function promptRequestsClose(prompt: string) {
  const text = normalizePrompt(prompt);
  return AUTO_CLOSE_EN_RE.test(text) || AUTO_CLOSE_ZH_RE.test(text);
}

export function promptRequestsNewScript(prompt: string) {
  const text = normalizePrompt(prompt);
  return AUTO_NEW_SCRIPT_EN_RE.test(text) || AUTO_NEW_SCRIPT_ZH_RE.test(text);
}

export function promptRequestsSave(prompt: string) {
  const text = normalizePrompt(prompt);
  return AUTO_SAVE_EN_RE.test(text) || AUTO_SAVE_ZH_RE.test(text);
}

export function promptRequestsScriptGeneration(prompt: string) {
  const text = normalizePrompt(prompt);
  return SCRIPT_CREATE_EN_RE.test(text) || SCRIPT_CREATE_ZH_RE.test(text);
}
