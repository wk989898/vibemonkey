import { AI_STREAM_EVENT, type AiStreamPayload } from "@/common/ai-stream";
import { promptRequestsScriptGeneration } from "@/common/ai-script-intent";
import { addBackgroundHandlers } from "./bridge";
import { sendCmd } from "./util";

const HOST_ID = "vm-ai-page-chat-host";
const MAX_CHAT_ROUNDS = 4;
const MAX_HISTORY_MESSAGES = 12;
const MAX_PAGE_HEADINGS = 12;
const MAX_PAGE_FORMS = 6;
const MAX_PAGE_FORM_FIELDS = 8;
const MAX_PAGE_SCRIPTS = 16;
const MAX_SELECTION_PREVIEW_CHARS = 500;
const MAX_SUMMARY_TEXT_CHARS = 240;
const MAX_CONTEXT_BLOCKS = 12;
const MAX_CONTEXT_BLOCK_CHARS = 12000;
const MAX_SEARCH_MATCHES = 5;
const MAX_SEARCH_CONTEXT_CHARS = 300;
const MAX_REQUEST_QUERY_CHARS = 200;
const MAX_REQUEST_SELECTOR_CHARS = 240;
const MAX_REQUEST_HTML_CHARS = 12000;
const MAX_REQUEST_TEXT_CHARS = 12000;
const MAX_REQUEST_SCRIPT_CHARS = 12000;
const KEYBOARD_EVENTS = ["keydown", "keypress", "keyup"] as const;
const DEFAULT_STATUS =
  "AI starts from a lightweight page index and fetches HTML or scripts only when needed. It can also create and save userscripts for the current page.";
const PANEL_CSS = `
:host {
  all: initial;
}
.vm-ai-panel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: min(420px, calc(100vw - 24px));
  height: min(560px, calc(100vh - 24px));
  display: flex;
  flex-direction: column;
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #1f2933;
  background: rgba(250, 252, 255, 0.98);
  border: 1px solid rgba(49, 79, 111, 0.22);
  border-radius: 16px;
  box-shadow: 0 20px 55px rgba(15, 23, 42, 0.26);
  overflow: hidden;
  backdrop-filter: blur(16px);
  z-index: 2147483647;
}
.vm-ai-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  color: #eff6ff;
  background: linear-gradient(135deg, #0f172a, #1d4ed8 55%, #38bdf8);
}
.vm-ai-title {
  flex: 1;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.vm-ai-header button,
.vm-ai-send {
  appearance: none;
  border: 0;
  border-radius: 10px;
  cursor: pointer;
  transition: opacity 120ms ease, transform 120ms ease, background 120ms ease;
}
.vm-ai-header button {
  padding: 6px 9px;
  color: inherit;
  background: rgba(255, 255, 255, 0.18);
}
.vm-ai-header button:hover,
.vm-ai-send:hover {
  opacity: 0.92;
}
.vm-ai-header button:active,
.vm-ai-send:active {
  transform: translateY(1px);
}
.vm-ai-body {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  background:
    radial-gradient(circle at top right, rgba(56, 189, 248, 0.18), transparent 32%),
    linear-gradient(180deg, #f8fbff, #eef5ff);
}
.vm-ai-messages {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px;
}
.vm-ai-empty {
  padding: 14px;
  border: 1px dashed rgba(49, 79, 111, 0.22);
  border-radius: 12px;
  color: #496176;
  background: rgba(255, 255, 255, 0.74);
}
.vm-ai-message {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 14px;
  white-space: pre-wrap;
  word-break: break-word;
  background: rgba(255, 255, 255, 0.84);
  border: 1px solid rgba(49, 79, 111, 0.12);
}
.vm-ai-message:last-child {
  margin-bottom: 0;
}
.vm-ai-message-user {
  margin-left: 30px;
  background: linear-gradient(180deg, #0f766e, #0f766e 45%, #115e59);
  color: #ecfeff;
  border-color: rgba(15, 118, 110, 0.18);
}
.vm-ai-message-assistant {
  margin-right: 30px;
}
.vm-ai-role {
  display: block;
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.75;
}
.vm-ai-footer {
  padding: 12px 14px 14px;
  border-top: 1px solid rgba(49, 79, 111, 0.12);
  background: rgba(255, 255, 255, 0.76);
}
.vm-ai-status {
  min-height: 18px;
  margin-bottom: 8px;
  color: #496176;
}
.vm-ai-status-error {
  color: #b42318;
}
.vm-ai-input {
  width: 100%;
  min-height: 84px;
  max-height: 180px;
  padding: 10px 12px;
  box-sizing: border-box;
  resize: vertical;
  color: inherit;
  background: rgba(248, 250, 252, 0.98);
  border: 1px solid rgba(49, 79, 111, 0.22);
  border-radius: 12px;
  outline: none;
}
.vm-ai-input:focus {
  border-color: rgba(29, 78, 216, 0.55);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.16);
}
.vm-ai-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 10px;
}
.vm-ai-send {
  padding: 9px 14px;
  font-weight: 700;
  color: #eff6ff;
  background: linear-gradient(135deg, #1d4ed8, #0284c7);
}
.vm-ai-send[disabled],
.vm-ai-input[disabled] {
  opacity: 0.6;
  cursor: not-allowed;
}
@media (max-width: 640px) {
  .vm-ai-panel {
    right: 12px;
    left: 12px;
    bottom: 12px;
    width: auto;
    height: min(70vh, 560px);
  }
}
`;

let host;
let elements;
let isBusy = false;
let messages: Array<{ content: string; role: "assistant" | "user" }> = [];
let requestSequence = 0;
let panelRoot: HTMLElement | null = null;
const streamListeners = Object.create(null) as Record<string, (delta: string) => void>;

type PageChatResponse = {
  code?: string;
  content?: string;
  contextBlocks?: unknown[];
  model?: string;
  plan?: {
    actions?: Array<{
      mode?: string;
      tool?: string;
    }>;
  } | null;
  requests?: unknown[];
  type?: "contextRequest" | "final" | "script";
};

type SavedScriptResponse = {
  id?: number;
  message?: string;
  name?: string;
};

type PageToolCallPayload = {
  args?: Record<string, unknown>;
  name?: string;
};

addBackgroundHandlers(
  {
    AiOpenPanel() {
      showPanel();
      return true;
    },
    AiResolvePageTool(payload: PageToolCallPayload) {
      return resolvePageToolCall(payload);
    },
    [AI_STREAM_EVENT](payload: AiStreamPayload) {
      const requestId = `${payload?.requestId || ""}`;
      const delta = `${payload?.delta || ""}`;
      if (requestId && delta) {
        streamListeners[requestId]?.(delta);
      }
    },
  },
  true,
);

function showPanel() {
  ensurePanel();
  if (!host) {
    return;
  }
  host.hidden = false;
  renderMessages();
  focusInput();
}

function ensurePanel() {
  if (host?.isConnected) {
    return;
  }
  const root = document.documentElement || document.body;
  if (!root) {
    return;
  }
  host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = PANEL_CSS;
  const panel = document.createElement("section");
  panel.className = "vm-ai-panel";
  panel.innerHTML = `
    <div class="vm-ai-header">
      <div class="vm-ai-title">AI</div>
      <button type="button" data-action="clear">New</button>
      <button type="button" data-action="close">Close</button>
    </div>
    <div class="vm-ai-body">
      <div class="vm-ai-messages"></div>
      <div class="vm-ai-footer">
        <div class="vm-ai-status"></div>
        <textarea class="vm-ai-input" spellcheck="false"
          placeholder="Ask about this page, or ask AI to create and save a userscript for it."></textarea>
        <div class="vm-ai-actions">
          <button type="button" class="vm-ai-send">Send</button>
        </div>
      </div>
    </div>
  `;
  shadow.append(style, panel);
  root.append(host);
  panelRoot = panel;
  elements = {
    messages: shadow.querySelector(".vm-ai-messages"),
    status: shadow.querySelector(".vm-ai-status"),
    input: shadow.querySelector(".vm-ai-input"),
    send: shadow.querySelector(".vm-ai-send"),
    clear: shadow.querySelector('[data-action="clear"]'),
    close: shadow.querySelector('[data-action="close"]'),
  };
  bindKeyboardIsolation(shadow, panel);
  elements.send.addEventListener("click", onSend);
  elements.clear.addEventListener("click", onClear);
  elements.close.addEventListener("click", onClose);
  elements.input.addEventListener("keydown", onInputKeydown);
  setStatus(DEFAULT_STATUS);
}

function onClear() {
  messages = [];
  setStatus(DEFAULT_STATUS);
  renderMessages();
  focusInput();
}

function onClose() {
  host.hidden = true;
}

function onInputKeydown(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    onSend();
  }
}

function bindKeyboardIsolation(shadow: ShadowRoot, panel: HTMLElement) {
  const stopInsidePanel = (event: KeyboardEvent) => {
    if (!isPanelKeyboardEvent(event, shadow, panel)) {
      return;
    }
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  };
  KEYBOARD_EVENTS.forEach((type) => {
    shadow.addEventListener(type, stopInsidePanel, true);
    globalThis.addEventListener(type, stopInsidePanel, true);
  });
}

function isPanelKeyboardEvent(event: KeyboardEvent, shadow: ShadowRoot, panel: HTMLElement) {
  if (host?.hidden) {
    return false;
  }
  const active = shadow.activeElement;
  if (active && panel.contains(active)) {
    return true;
  }
  const target = event.target;
  if (target instanceof Node && panel.contains(target)) {
    return true;
  }
  const path = event.composedPath?.() || [];
  return path.includes(host) || path.includes(panel) || path.includes(panelRoot);
}

async function onSend() {
  if (isBusy) {
    return;
  }
  const prompt = elements?.input?.value?.trim();
  if (!prompt) {
    return;
  }
  const history = messages.slice(-MAX_HISTORY_MESSAGES);
  messages.push({
    role: "user",
    content: prompt,
  });
  elements.input.value = "";
  isBusy = true;
  updateBusyState();
  setStatus("Thinking...");
  renderMessages();
  try {
    if (promptRequestsScriptGeneration(prompt)) {
      await runScriptGeneration(prompt, history);
    } else {
      await runChat(prompt, history);
    }
    setStatus(DEFAULT_STATUS);
  } catch (err) {
    setStatus(formatError(err), true);
  } finally {
    isBusy = false;
    updateBusyState();
    renderMessages();
    focusInput();
  }
}

async function runChat(prompt, history) {
  let contextBlocks = [];
  for (let round = 0; round < MAX_CHAT_ROUNDS; round += 1) {
    const beforeCount = contextBlocks.length;
    const requestId = createRequestId();
    const streamState = createAssistantStreamState();
    const stopStreaming = listenAiStream(requestId, (delta) => {
      streamState.push(delta);
      setStatus("Streaming reply...");
      renderMessages();
    });
    let res: PageChatResponse;
    try {
      res = (await sendCmd("AiPageChat", {
        prompt,
        history,
        page: collectPageIndex(),
        contextBlocks,
        requestId,
      })) as PageChatResponse;
    } finally {
      stopStreaming();
    }
    contextBlocks = mergeContextBlocks(contextBlocks, res?.contextBlocks);
    if (res?.type !== "contextRequest") {
      streamState.commit(`${res?.content || ""}`.trim() || "(empty response)");
      return res;
    }
    streamState.discard();
    if (res.requests?.length) {
      setStatus(`Fetching ${res.requests.length} requested snippet(s)...`);
    } else {
      setStatus("Fetching requested context...");
    }
    contextBlocks = mergeContextBlocks(contextBlocks, resolveContextRequests(res.requests));
    if (contextBlocks.length === beforeCount) {
      throw new Error("AI requested more context, but no new snippets could be retrieved.");
    }
    setStatus("Refining the answer...");
  }
  throw new Error("AI requested too many context fetch rounds.");
}

async function runScriptGeneration(prompt, history) {
  setStatus("Generating userscript...");
  const res = await sendCmd("AiGenerateScriptForPage", {
    prompt,
    history,
    page: collectPageIndex(),
    requestId: createRequestId(),
  });
  await handleGeneratedScriptResult(res as PageChatResponse);
}

function createAssistantStreamState() {
  let content = "";
  let messageIndex = -1;
  let revealed = false;
  return {
    commit(finalContent: string) {
      if (!revealed || messageIndex < 0) {
        messages.push({
          role: "assistant",
          content: finalContent,
        });
        return;
      }
      messages[messageIndex].content = finalContent;
    },
    discard() {
      if (revealed && messageIndex >= 0) {
        messages.splice(messageIndex, 1);
      }
    },
    push(delta: string) {
      content += delta;
      if (!revealed) {
        const trimmed = content.trimStart();
        if (!trimmed || trimmed.startsWith("{") || trimmed.startsWith("```json")) {
          return;
        }
        revealed = true;
        messageIndex =
          messages.push({
            role: "assistant",
            content,
          }) - 1;
        return;
      }
      messages[messageIndex].content = content;
    },
  };
}

function createRequestId() {
  requestSequence += 1;
  return `vm-ai-page-${Date.now().toString(36)}-${requestSequence}`;
}

function listenAiStream(requestId: string, listener: (delta: string) => void) {
  streamListeners[requestId] = listener;
  return () => {
    if (streamListeners[requestId] === listener) {
      delete streamListeners[requestId];
    }
  };
}

function renderMessages() {
  if (!elements) {
    return;
  }
  const parent = elements.messages;
  parent.textContent = "";
  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "vm-ai-empty";
    empty.textContent =
      "The assistant starts from a lightweight page index. It can search HTML, inspect script tags, fetch matched userscript code, and create a new userscript for the current page.";
    parent.append(empty);
  } else {
    messages.forEach((item) => {
      const box = document.createElement("div");
      box.className = `vm-ai-message vm-ai-message-${item.role}`;
      const role = document.createElement("span");
      role.className = "vm-ai-role";
      role.textContent = item.role === "user" ? "You" : "AI";
      const text = document.createElement("div");
      text.textContent = item.content;
      box.append(role, text);
      parent.append(box);
    });
  }
  requestAnimationFrame(() => {
    parent.scrollTop = parent.scrollHeight;
  });
}

function updateBusyState() {
  if (!elements) {
    return;
  }
  elements.input.disabled = isBusy;
  elements.send.disabled = isBusy;
  elements.send.textContent = isBusy ? "Thinking..." : "Send";
}

function focusInput() {
  elements?.input?.focus();
}

function setStatus(text, isError = false) {
  if (!elements) {
    return;
  }
  elements.status.textContent = text || "";
  elements.status.className = `vm-ai-status${isError ? " vm-ai-status-error" : ""}`;
}

function collectPageIndex() {
  const docEl = document.documentElement;
  const selection = global.getSelection?.().toString() || "";
  return {
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    language: docEl?.lang || "",
    selectionPreview: trimText(selection, MAX_SELECTION_PREVIEW_CHARS),
    counts: {
      forms: document.forms?.length || 0,
      links: document.links?.length || 0,
      buttons: document.querySelectorAll('button,input[type="button"],input[type="submit"]').length,
      scripts: document.scripts?.length || 0,
      iframes: document.querySelectorAll("iframe").length,
    },
    landmarks: collectLandmarks(),
    headings: collectHeadings(),
    forms: collectForms(),
    scripts: collectScriptIndex(),
  };
}

function collectLandmarks() {
  const res = {};
  for (const selector of ["main", "header", "nav", "footer", "article"]) {
    const element = document.querySelector(selector);
    if (element) {
      res[selector] = buildSelector(element);
    }
  }
  return res;
}

function collectHeadings() {
  return Array.from(document.querySelectorAll("h1, h2, h3"))
    .slice(0, MAX_PAGE_HEADINGS)
    .map((element) => ({
      level: element.localName,
      selector: buildSelector(element),
      text: summarizeText(getElementText(element), MAX_SUMMARY_TEXT_CHARS),
    }))
    .filter((item) => item.selector || item.text);
}

function collectForms() {
  return Array.from(document.forms || [])
    .slice(0, MAX_PAGE_FORMS)
    .map((form) => ({
      selector: buildSelector(form),
      action: summarizeText(
        form.getAttribute("action") || form.action || "",
        MAX_SUMMARY_TEXT_CHARS,
      ),
      method: summarizeText(form.getAttribute("method") || form.method || "get", 20),
      fields: Array.from(form.querySelectorAll("input, textarea, select, button"))
        .slice(0, MAX_PAGE_FORM_FIELDS)
        .map(summarizeFormField)
        .filter(Boolean),
    }));
}

function collectScriptIndex() {
  return Array.from(document.scripts || [])
    .slice(0, MAX_PAGE_SCRIPTS)
    .map((script, index) => ({
      index,
      src: summarizeText(script.src, 500),
      type: summarizeText(script.type, 80),
      id: summarizeText(script.id, 120),
      async: !!script.async,
      defer: !!script.defer,
      module: script.type === "module",
      inlineLength: script.src ? 0 : `${script.textContent || ""}`.length,
    }));
}

function summarizeFormField(field) {
  const name = summarizeText(field.name || field.id || field.localName, 40);
  const type = summarizeText(field.type || field.localName, 30);
  const placeholder = summarizeText(field.placeholder || "", 40);
  return [name, type, placeholder].filter(Boolean).join(" | ");
}

function resolveContextRequests(requests) {
  return normalizeContextBlocks(
    (Array.isArray(requests) ? requests : []).map(resolveContextRequest).filter(Boolean),
  );
}

function resolvePageToolCall(payload: PageToolCallPayload) {
  const request = normalizeToolRequest(payload?.name, payload?.args);
  return (
    resolveContextRequest(request) ||
    makeToolResultBlock(
      "tool-error",
      "AI page tool error",
      `Unsupported or invalid tool call: ${payload?.name || "(unknown)"}.`,
    )
  );
}

function normalizeToolRequest(name: string | undefined, args: Record<string, unknown> | undefined) {
  const kind =
    {
      get_html: "getHtml",
      get_script_tag: "getScriptTag",
      get_selection: "getSelection",
      get_text: "getText",
      search_html: "searchHtml",
      search_script_tags: "searchScriptTags",
      search_text: "searchText",
    }[`${name || ""}`] || "";
  if (!kind) {
    return null;
  }
  const renamedArgs = {};
  Object.entries(args || {}).forEach(([key, value]) => {
    renamedArgs[
      {
        context_chars: "contextChars",
        max_chars: "maxChars",
        max_matches: "maxMatches",
      }[key] || key
    ] = value;
  });
  return normalizeToolRequestPayload({
    kind,
    ...renamedArgs,
  });
}

function normalizeToolRequestPayload(request) {
  const kind = `${request?.kind || ""}`.trim();
  if (!kind) {
    return null;
  }
  if (kind === "searchHtml" || kind === "searchText" || kind === "searchScriptTags") {
    const query = summarizeText(request.query, MAX_REQUEST_QUERY_CHARS);
    if (!query) {
      return null;
    }
    return {
      kind,
      query,
      maxMatches: clampNumber(request.maxMatches, 1, MAX_SEARCH_MATCHES, 3),
      contextChars: clampNumber(request.contextChars, 60, MAX_SEARCH_CONTEXT_CHARS, 160),
    };
  }
  if (kind === "getHtml" || kind === "getText") {
    const selector = summarizeText(request.selector, MAX_REQUEST_SELECTOR_CHARS);
    if (!selector) {
      return null;
    }
    return {
      kind,
      selector,
      index: clampNumber(request.index, 0, 20, 0),
      maxChars: clampNumber(
        request.maxChars,
        200,
        kind === "getHtml" ? MAX_REQUEST_HTML_CHARS : MAX_REQUEST_TEXT_CHARS,
        4000,
      ),
    };
  }
  if (kind === "getScriptTag") {
    return {
      kind,
      index: clampNumber(request.index, 0, 999, 0),
      maxChars: clampNumber(request.maxChars, 200, MAX_REQUEST_SCRIPT_CHARS, 6000),
    };
  }
  if (kind === "getSelection") {
    return {
      kind,
      maxChars: clampNumber(request.maxChars, 100, 4000, 1000),
    };
  }
  return null;
}

function resolveContextRequest(request) {
  switch (`${request?.kind || ""}`) {
    case "searchHtml":
      return makeSearchBlock(
        "search-html",
        `HTML search: ${request.query}`,
        document.documentElement?.outerHTML || "",
        request.query,
        request.maxMatches,
        request.contextChars,
      );
    case "searchText":
      return makeSearchBlock(
        "search-text",
        `Visible text search: ${request.query}`,
        document.body?.innerText || document.body?.textContent || "",
        request.query,
        request.maxMatches,
        request.contextChars,
      );
    case "searchScriptTags":
      return makeScriptSearchBlock(request);
    case "getHtml":
      return makeElementBlock(request, true);
    case "getText":
      return makeElementBlock(request, false);
    case "getScriptTag":
      return makeScriptTagBlock(request);
    case "getSelection":
      return {
        key: "selection",
        title: "Current selection",
        mime: "text/plain",
        content: trimText(global.getSelection?.().toString() || "(none)", request.maxChars || 1000),
      };
    default:
      return null;
  }
}

function makeToolResultBlock(key: string, title: string, content: string) {
  return {
    key,
    title,
    mime: "text/plain",
    content,
  };
}

function makeSearchBlock(keyPrefix, title, source, query, maxMatches, contextChars) {
  query = `${query || ""}`.trim();
  if (!query) {
    return null;
  }
  const matches = findMatches(
    `${source || ""}`,
    query,
    clampNumber(maxMatches, 1, MAX_SEARCH_MATCHES, 3),
    clampNumber(contextChars, 60, MAX_SEARCH_CONTEXT_CHARS, 160),
  );
  return {
    key: `${keyPrefix}:${query.toLowerCase()}`,
    title,
    mime: "text/plain",
    content: matches.length
      ? matches.map((snippet, index) => `${index + 1}. ${snippet}`).join("\n\n")
      : `No matches found for "${query}".`,
  };
}

function makeScriptSearchBlock(request) {
  const query = `${request?.query || ""}`.trim();
  if (!query) {
    return null;
  }
  const lowerQuery = query.toLowerCase();
  const matches = [];
  Array.from(document.scripts || []).some((script, index) => {
    const src = script.src || "";
    const type = script.type || "";
    const id = script.id || "";
    const inline = script.src ? "" : `${script.textContent || ""}`;
    const haystack = `${src}\n${type}\n${id}\n${inline}`.toLowerCase();
    if (!haystack.includes(lowerQuery)) {
      return false;
    }
    const snippets = inline ? findMatches(inline, query, 1, 140) : [];
    matches.push(
      [
        `Script #${index}`,
        src && `src=${src}`,
        type && `type=${type}`,
        id && `id=${id}`,
        snippets[0] && `snippet=${snippets[0]}`,
      ]
        .filter(Boolean)
        .join(" | "),
    );
    return matches.length >= clampNumber(request.maxMatches, 1, MAX_SEARCH_MATCHES, 3);
  });
  return {
    key: `search-scripts:${query.toLowerCase()}`,
    title: `Script tag search: ${query}`,
    mime: "text/plain",
    content: matches.length ? matches.join("\n\n") : `No script tags matched "${query}".`,
  };
}

function makeElementBlock(request, isHtml) {
  const selector = `${request?.selector || ""}`.trim();
  if (!selector) {
    return null;
  }
  let element;
  try {
    element = document.querySelectorAll(selector)[clampNumber(request.index, 0, 20, 0)];
  } catch (err) {
    return {
      key: `${isHtml ? "html" : "text"}:${selector}:${request?.index || 0}`,
      title: `${isHtml ? "HTML" : "Text"} for ${selector}`,
      mime: "text/plain",
      content: `Invalid selector: ${err?.message || err}`,
    };
  }
  const content = element
    ? trimText(
        isHtml ? element.outerHTML : getElementText(element),
        request.maxChars || (isHtml ? MAX_REQUEST_HTML_CHARS : MAX_REQUEST_TEXT_CHARS),
      )
    : "Selector not found.";
  return {
    key: `${isHtml ? "html" : "text"}:${selector}:${request?.index || 0}`,
    title: `${isHtml ? "HTML" : "Text"} for ${selector}`,
    mime: isHtml ? "text/html" : "text/plain",
    content,
  };
}

function makeScriptTagBlock(request) {
  const index = clampNumber(request?.index, 0, 999, 0);
  const script = document.scripts?.[index];
  if (!script) {
    return {
      key: `script:${index}`,
      title: `Script tag #${index}`,
      mime: "text/plain",
      content: "Script tag not found.",
    };
  }
  const content = [
    "Metadata:",
    JSON.stringify(
      {
        index,
        src: script.src || "",
        type: script.type || "",
        id: script.id || "",
        async: !!script.async,
        defer: !!script.defer,
        module: script.type === "module",
      },
      null,
      2,
    ),
    "",
    "Content:",
    script.src
      ? "This is an external script tag. Its src file should be fetched by the background if needed."
      : trimText(script.textContent, request.maxChars || MAX_REQUEST_SCRIPT_CHARS),
  ].join("\n");
  return {
    key: `script:${index}`,
    title: `Script tag #${index}`,
    mime: script.src ? "application/json" : "text/javascript",
    content,
  };
}

function mergeContextBlocks(existing, extra) {
  const map = new Map();
  (existing || []).forEach((block) => {
    const normalized = normalizeContextBlock(block);
    if (normalized && !map.has(normalized.key)) {
      map.set(normalized.key, normalized);
    }
  });
  (extra || []).forEach((block) => {
    const normalized = normalizeContextBlock(block);
    if (normalized && !map.has(normalized.key)) {
      map.set(normalized.key, normalized);
    }
  });
  const res = [];
  map.forEach((block) => {
    res.push(block);
  });
  return res.slice(-MAX_CONTEXT_BLOCKS);
}

function normalizeContextBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .map(normalizeContextBlock)
    .filter(Boolean)
    .slice(-MAX_CONTEXT_BLOCKS);
}

function normalizeContextBlock(block) {
  const key = summarizeText(block?.key, 240);
  const title = summarizeText(block?.title, 240);
  const content = trimText(block?.content, MAX_CONTEXT_BLOCK_CHARS);
  if (!key || !title || !content) {
    return null;
  }
  return {
    key,
    title,
    mime: summarizeText(block?.mime, 60) || "text/plain",
    content,
  };
}

function findMatches(source, query, maxMatches, contextChars) {
  source = `${source || ""}`;
  query = `${query || ""}`;
  if (!source || !query) {
    return [];
  }
  const lowerSource = source.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matches = [];
  let from = 0;
  while (matches.length < maxMatches) {
    const index = lowerSource.indexOf(lowerQuery, from);
    if (index < 0) {
      break;
    }
    const start = Math.max(index - contextChars, 0);
    const end = Math.min(index + lowerQuery.length + contextChars, source.length);
    matches.push(compactSnippet(source.slice(start, end), start > 0, end < source.length));
    from = index + lowerQuery.length;
  }
  return matches;
}

function compactSnippet(text, prefix, suffix) {
  text = `${text || ""}`.replace(/\s+/g, " ").trim();
  return `${prefix ? "..." : ""}${text}${suffix ? "..." : ""}`;
}

function getElementText(element) {
  if (!element) {
    return "";
  }
  return ("innerText" in element && `${element.innerText || ""}`) || element.textContent || "";
}

function buildSelector(element) {
  const parts = [];
  for (let el = element; el?.localName && parts.length < 4; el = el.parentElement) {
    let part = el.localName;
    if (el.id) {
      part += `#${escapeCss(el.id)}`;
      parts.unshift(part);
      break;
    }
    const classes = Array.from(el.classList || [])
      .filter(Boolean)
      .slice(0, 2)
      .map((cls) => `.${escapeCss(cls)}`)
      .join("");
    if (classes) {
      part += classes;
    }
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from<Element>(parent.children).filter(
        (child) => child.localName === el.localName,
      );
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(el) + 1})`;
      }
    }
    parts.unshift(part);
    if (el === document.body || el === document.documentElement) {
      break;
    }
  }
  return parts.join(" > ");
}

function escapeCss(text) {
  return global.CSS?.escape
    ? global.CSS.escape(text)
    : `${text}`.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function summarizeText(text, maxLength) {
  return trimText(`${text || ""}`.replace(/\s+/g, " ").trim(), maxLength);
}

function clampNumber(value, min, max, fallback) {
  value = Number(value);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

function trimText(text, maxLength) {
  text = `${text || ""}`;
  if (!maxLength || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(maxLength - 24, 0)).trimEnd()}\n...[truncated]`;
}

function formatError(err) {
  return err?.message || `${err || "AI request failed."}`;
}

async function handleGeneratedScriptResult(
  res: PageChatResponse,
  streamState?: ReturnType<typeof createAssistantStreamState>,
) {
  const code = `${res?.code || ""}`.trim();
  if (!code) {
    throw new Error("AI did not return any userscript code.");
  }
  if (hasSaveAction(res.plan)) {
    streamState?.discard();
    setStatus("Saving script...");
    try {
      const saved = (await sendCmd("AiSaveGeneratedScript", {
        code,
      })) as SavedScriptResponse;
      messages.push({
        role: "assistant",
        content: [
          `Created and saved script${saved?.name ? ` "${saved.name}"` : ""}.`,
          saved?.id ? `Script ID: ${saved.id}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      });
      return;
    } catch (err) {
      messages.push({
        role: "assistant",
        content: code,
      });
      throw err;
    }
  }
  if (streamState) {
    streamState.commit(code);
  } else {
    messages.push({
      role: "assistant",
      content: code,
    });
  }
}

function hasSaveAction(
  plan: PageChatResponse["plan"],
) {
  return !!plan?.actions?.some(
    (action) => action?.tool === "save_script" && action?.mode === "create",
  );
}
