import { isTouch } from "..";
import options from "../../options";
import "./style.css";

export let customCssElem: HTMLStyleElement | undefined;
let styleTheme: HTMLStyleElement | undefined;
let darkMediaRules: CSSMediaRule[] | undefined;
let storageCache: Storage | Record<string, string> = {};
const isStorage = (value: Storage | Record<string, string>): value is Storage =>
  typeof (value as Storage).getItem === "function";
/* Accessing `localStorage` in may throw in Private Browsing mode or if dom.storage is disabled.
 * Since it allows object-like access, we'll map it to a variable with a fallback to a dummy. */
try {
  (storageCache = globalThis.localStorage).getItem("foo");
} catch (e) {
  storageCache = {};
}

const CACHE_KEY = "cacheCustomCSS";

const setStyle = (css: string, elem?: HTMLStyleElement) => {
  if (css && !elem) {
    elem = document.createElement("style");
    document.documentElement.appendChild(elem);
  }
  if ((css || elem) && elem.textContent !== css) {
    elem.textContent = css;
  }
  return elem;
};

export const findStyleSheetRules = (darkThemeCondition: string) => {
  const res: CSSMediaRule[] = [];
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if ((rule as CSSMediaRule).conditionText?.includes(darkThemeCondition)) {
        res.push(rule as CSSMediaRule);
      }
    }
  }
  return res;
};

const setUiTheme = (theme: string) => {
  const darkThemeCondition = "(prefers-color-scheme: dark)";
  const mediaText =
    (theme === "dark" && "screen") || (theme === "light" && "not all") || darkThemeCondition;
  if (!darkMediaRules) {
    darkMediaRules = findStyleSheetRules(darkThemeCondition);
  }
  darkMediaRules.forEach((rule) => {
    rule.media.mediaText = mediaText;
  });
};

const getCachedCss = () =>
  isStorage(storageCache) ? storageCache.getItem(CACHE_KEY) || "" : storageCache[CACHE_KEY] || "";

const setCachedCss = (value: string) => {
  if (isStorage(storageCache)) {
    if (value) storageCache.setItem(CACHE_KEY, value);
    else storageCache.removeItem(CACHE_KEY);
  } else if (value) {
    storageCache[CACHE_KEY] = value;
  } else {
    delete storageCache[CACHE_KEY];
  }
};

customCssElem = setStyle(getCachedCss());

options.hook((changes) => {
  let v: unknown;
  if ((v = changes.editorTheme) != null && !globalThis.location.pathname.startsWith("/popup")) {
    styleTheme = setStyle(`${v}`, styleTheme);
  }
  if ((v = changes.uiTheme) != null) {
    setUiTheme(`${v}`);
  }
  if ((v = changes.customCSS) != null) {
    const css = `${v}`;
    customCssElem = setStyle(css, customCssElem);
    setCachedCss(css);
  }
});

if (isTouch) {
  document.documentElement.classList.add("touch");
}
document.documentElement.lang = chrome.i18n.getUILanguage(); // enable CSS hyphenation
