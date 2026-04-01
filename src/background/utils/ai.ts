import { getScriptName, getScriptRunAt, ignoreNoReceiver, sendTabCmd } from "@/common";
import { AI_STREAM_EVENT, type AiStreamPayload } from "@/common/ai-stream";
import { DEFAULT_AI_API_URL, DEFAULT_AI_MODEL, resolveAiEndpoint } from "@/common/ai-config";
import { browser } from "@/common/consts";
import {
  createAiResponseStreamParser,
  getAiErrorMessage,
  parseAiResponseBody,
} from "./ai-response";
import { extractGeneratePlan, extractGeneratedCode } from "./ai-generate";
import { getScriptsByURL } from "./db";
import { addOwnCommands, addPublicCommands } from "./init";
import { getOption } from "./options";
import storage, { S_CODE } from "./storage";

const JSON_BLOCK_RE = /```json\s*([\s\S]*?)```/i;
const DEFAULT_GENERATE_SYSTEM_PROMPT = [
  "You are an expert userscript author working inside Violentmonkey.",
  "Return a complete userscript file that the user can save immediately.",
  "Always include a valid ==UserScript== metadata block.",
  "Preserve the intent of the existing script unless the user explicitly asks to change it.",
  'Before the code, return one ```json``` block with {"actions":[...]} describing tool calls.',
  'Always include {"tool":"apply_code"} as the first action.',
  'Use {"tool":"update_script_settings","settings":{...}} only when the user explicitly asks to change editor-side settings such as enabled state, tags, @run-at, @inject-into, custom name, or custom description.',
  'Use {"tool":"save_script","mode":"create"} only when the user explicitly asks to create/save/install a new script now, including saving the current draft as a separate new script.',
  'Use {"tool":"save_script","mode":"update"} only when the user explicitly asks to save the current script in place.',
  'Use {"tool":"close_editor"} only when the user explicitly asks to save and close immediately.',
  'For normal drafting or refactoring without explicit save intent, return only {"actions":[{"tool":"apply_code"}]}.',
  "After the JSON block, return the code in a single ```javascript``` block.",
  "Do not add prose outside those blocks.",
].join("\n");
const DEFAULT_PAGE_CHAT_SYSTEM_PROMPT = [
  "You are an AI assistant embedded in a live web page via Violentmonkey.",
  "Use selective retrieval to minimize token usage.",
  "You will receive a lightweight page index, matched userscript summaries, and any previously fetched context blocks.",
  'If you need more context, do not answer yet. Return only a JSON object with {"type":"context_request","requests":[...]} and no extra prose.',
  "Prefer searchHtml, searchText, or searchScriptTags before requesting raw HTML or source code.",
  "Use getUserscript only for matched userscripts listed in the provided summaries.",
  "Use getScriptTag for script tags listed in the page index. External script src files will be fetched on demand.",
  "Once you have enough information, answer normally and do not output JSON.",
  "Answer only from the supplied context. Do not invent selectors, functions, or page behavior.",
  "If the supplied snippets are truncated, say so and ask a narrower follow-up question.",
  "Reply in the same language as the user when practical.",
].join("\n");
const CONTEXT_REQUEST_EXAMPLE = JSON.stringify(
  {
    type: "context_request",
    requests: [
      { kind: "searchHtml", query: "login form" },
      { kind: "getHtml", selector: "form#login", maxChars: 3000 },
      { kind: "getScriptTag", index: 2, maxChars: 6000 },
      { kind: "getUserscript", id: 12, maxChars: 6000 },
    ],
  },
  null,
  2,
);
const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_MESSAGE_CHARS = 4000;
const MAX_MATCHED_USERSCRIPTS = 12;
const MAX_CONTEXT_BLOCKS = 12;
const MAX_CONTEXT_BLOCK_CHARS = 12000;
const MAX_CONTEXT_BLOCK_TOTAL_CHARS = 40000;
const MAX_CONTEXT_REQUESTS = 4;
const MAX_REQUEST_QUERY_CHARS = 200;
const MAX_REQUEST_SELECTOR_CHARS = 240;
const MAX_REQUEST_CHARS = 12000;
const MAX_REQUEST_MATCHES = 5;
const MAX_REQUEST_CONTEXT_CHARS = 300;
const MAX_USERSCRIPT_CODE_CHARS = 12000;
const MAX_SCRIPT_SOURCE_CHARS = 12000;

addOwnCommands({
  async AiGenerateScript({ prompt, code, requestId, script } = {}, src) {
    prompt = `${prompt || ""}`.trim();
    if (!prompt) {
      throw new SafeError("AI prompt is empty.");
    }
    code = `${code || ""}`;
    const { data, model } = await callAiApi({
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: DEFAULT_GENERATE_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: buildGeneratePrompt(prompt, code, script),
        },
      ],
      requestId: normalizeRequestId(requestId),
      src,
    });
    const content = getAiMessageContent(data);
    const plan = extractGeneratePlan(content);
    const generated = extractGeneratedCode(content);
    if (!generated.includes("==UserScript==")) {
      throw new SafeError("AI response did not contain a valid userscript metablock.");
    }
    return {
      plan,
      code: generated,
      content,
      model,
      usage: data.usage || null,
    };
  },
});

addPublicCommands({
  async AiPageChat({ prompt, history, page, contextBlocks, requestId } = {}, src) {
    prompt = `${prompt || ""}`.trim();
    if (!prompt) {
      throw new SafeError("AI prompt is empty.");
    }
    const isTop = !!src?.[kTop];
    const pageIndex = normalizePageIndex(page, src);
    const matchedScripts = getMatchedUserscriptSummaries(pageIndex.url, isTop);
    const knownContextBlocks = normalizeContextBlocks(contextBlocks);
    const { data, model } = await callAiApi({
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: DEFAULT_PAGE_CHAT_SYSTEM_PROMPT,
        },
        ...normalizeChatHistory(history),
        {
          role: "user",
          content: buildPageChatPrompt(prompt, pageIndex, matchedScripts, knownContextBlocks),
        },
      ],
      requestId: normalizeRequestId(requestId),
      src,
    });
    const content = getAiMessageContent(data);
    const request = parseContextRequest(content);
    if (request) {
      const resolved = await resolveBackgroundContextRequests(
        request.requests,
        pageIndex,
        matchedScripts,
        isTop,
      );
      return {
        type: "contextRequest",
        requests: resolved.pageRequests,
        contextBlocks: resolved.contextBlocks,
        model,
        usage: data.usage || null,
      };
    }
    return {
      type: "final",
      content,
      model,
      usage: data.usage || null,
      context: {
        matchedUserscripts: matchedScripts,
        pageUrl: pageIndex.url,
      },
    };
  },
});

function buildGeneratePrompt(prompt, code, script) {
  return [
    "Task:",
    prompt,
    "",
    "Script context:",
    JSON.stringify(script || {}, null, 2),
    "",
    "Current userscript code:",
    "```javascript",
    code.trim() || "// No existing script yet.",
    "```",
  ].join("\n");
}

function buildPageChatPrompt(prompt, pageIndex, matchedScripts, contextBlocks) {
  return [
    "User question:",
    prompt,
    "",
    "Context request protocol:",
    "Return only JSON when you need more context.",
    "```json",
    CONTEXT_REQUEST_EXAMPLE,
    "```",
    "",
    "Supported request kinds:",
    "- searchHtml: search raw HTML for a keyword or phrase.",
    "- searchText: search visible page text for a keyword or phrase.",
    "- searchScriptTags: search the script tag inventory and inline snippets by keyword.",
    "- getHtml: fetch outerHTML for a CSS selector.",
    "- getText: fetch visible text for a CSS selector.",
    "- getScriptTag: fetch an inline script tag or an external src file by index.",
    "- getSelection: fetch the current text selection.",
    "- getUserscript: fetch matched userscript code by id.",
    "",
    "Current page index:",
    JSON.stringify(pageIndex, null, 2),
    "",
    "Matched userscripts available:",
    JSON.stringify(matchedScripts, null, 2),
    "",
    ...formatContextBlocks(contextBlocks),
  ].join("\n");
}

function formatContextBlocks(contextBlocks) {
  if (!contextBlocks.length) {
    return ["Fetched context blocks:", "(none yet)", ""];
  }
  return [
    "Fetched context blocks:",
    "",
    ...contextBlocks.flatMap((block, index) => [
      `Context block ${index + 1}: ${block.title}`,
      `\`\`\`${getFenceType(block.mime)}`,
      block.content || "(empty)",
      "```",
      "",
    ]),
  ];
}

function getFenceType(mime) {
  return (
    {
      "text/html": "html",
      "text/javascript": "javascript",
      "application/json": "json",
    }[mime] || "text"
  );
}

function getAiMessageContent(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const outputBlocks = Array.isArray(data?.output) ? data.output : [];
  const outputText = outputBlocks
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((part) => part?.text || part?.content || "")
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (outputText) {
    return outputText;
  }
  const message = data?.choices?.[0]?.message;
  const { content } = message || {};
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => part?.text || part?.content || "")
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  throw new SafeError("AI response did not contain assistant content.");
}

async function callAiApi({ messages, temperature = 0.2, requestId, src }) {
  const { apiKey, apiStyle, apiUrl, model } = normalizeAiOptions(getOption("ai"));
  if (!apiKey) {
    throw new SafeError("AI API key is not configured.");
  }
  try {
    return await callAiApiStream({
      apiKey,
      apiStyle,
      apiUrl,
      messages,
      model,
      requestId,
      src,
      temperature,
    });
  } catch (err) {
    if (!shouldRetryWithoutStream(err)) {
      throw err;
    }
  }
  return callAiApiOnce({
    apiKey,
    apiStyle,
    apiUrl,
    messages,
    model,
    temperature,
  });
}

function normalizeAiOptions(options) {
  const endpoint = resolveAiEndpoint(options?.apiUrl || DEFAULT_AI_API_URL);
  return {
    apiKey: `${options?.apiKey || ""}`.trim(),
    apiStyle: endpoint.apiStyle,
    apiUrl: endpoint.apiUrl,
    model: `${options?.model || DEFAULT_AI_MODEL}`.trim() || DEFAULT_AI_MODEL,
  };
}

function buildAiRequestBody({ apiStyle, messages, model, temperature, stream }) {
  if (apiStyle === "responses") {
    const instructions = messages
      .filter((item) => item?.role === "system")
      .map((item) => messageContentToText(item.content))
      .filter(Boolean)
      .join("\n\n");
    return {
      model,
      stream,
      temperature,
      ...(instructions && { instructions }),
      input: messages
        .filter((item) => item?.role === "user" || item?.role === "assistant")
        .map(buildAiResponsesInputMessage)
        .filter(Boolean),
    };
  }
  return {
    model,
    stream,
    temperature,
    messages,
  };
}

function buildAiResponsesInputMessage(item) {
  const content = messageContentToText(item?.content);
  if (!content) {
    return null;
  }
  if (item?.role === "assistant") {
    return {
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: content,
        },
      ],
    };
  }
  return {
    role: "user",
    content,
  };
}

async function callAiApiOnce({ apiKey, apiStyle, apiUrl, messages, model, temperature }) {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildAiRequestBody({ apiStyle, messages, model, temperature, stream: false })),
  });
  const raw = await res.text();
  const data = parseAiResponseBody(raw);
  if (!res.ok) {
    throw new SafeError(
      getAiErrorMessage(data) || raw.slice(0, 500) || `AI request failed with HTTP ${res.status}.`,
    );
  }
  if (!data) {
    throw new SafeError(
      `AI response format was not recognized. ${truncateText(raw, 500) || "(empty response)"}`,
    );
  }
  return {
    data,
    model,
  };
}

async function callAiApiStream({
  apiKey,
  apiStyle,
  apiUrl,
  messages,
  model,
  requestId,
  src,
  temperature,
}) {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildAiRequestBody({ apiStyle, messages, model, temperature, stream: true })),
  });
  const parser = createAiResponseStreamParser(res.headers.get("content-type") || "");
  let emittedDelta = false;
  if (res.body?.getReader) {
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      const delta = parser.push(decoder.decode(value, { stream: true }));
      if (delta) {
        emittedDelta = true;
        await sendAiStreamDelta(requestId, src, delta);
      }
    }
    const tail = parser.push(decoder.decode());
    if (tail) {
      emittedDelta = true;
      await sendAiStreamDelta(requestId, src, tail);
    }
  } else {
    const delta = parser.push(await res.text());
    if (delta) {
      emittedDelta = true;
      await sendAiStreamDelta(requestId, src, delta);
    }
  }
  const { data, errorMessage, raw } = parser.finish();
  if (!res.ok) {
    const message =
      getAiErrorMessage(data) ||
      errorMessage ||
      raw.slice(0, 500) ||
      `AI request failed with HTTP ${res.status}.`;
    throw createAiRequestError(message, {
      emittedDelta,
      retryWithoutStream: !emittedDelta && isStreamUnsupportedMessage(message),
    });
  }
  if (!data) {
    throw createAiRequestError(
      `AI response format was not recognized. ${truncateText(raw, 500) || "(empty response)"}`,
      {
        emittedDelta,
      },
    );
  }
  return {
    data,
    model,
  };
}

function createAiRequestError(
  message,
  {
    emittedDelta = false,
    retryWithoutStream = false,
  }: {
    emittedDelta?: boolean;
    retryWithoutStream?: boolean;
  } = {},
) {
  const err = new SafeError(message) as Error & {
    emittedDelta?: boolean;
    retryWithoutStream?: boolean;
  };
  err.emittedDelta = emittedDelta;
  err.retryWithoutStream = retryWithoutStream;
  return err;
}

function shouldRetryWithoutStream(err) {
  return !!err?.retryWithoutStream && !err?.emittedDelta;
}

function isStreamUnsupportedMessage(message: string) {
  return /\b(?:stream(?:ing)?|event-stream|sse)\b/i.test(message) &&
    /\b(?:unsupported|not supported|invalid|unknown|unexpected|must be false)\b/i.test(message);
}

function normalizeRequestId(requestId) {
  const value = `${requestId || ""}`.trim();
  return value || "";
}

async function sendAiStreamDelta(requestId, src, delta: string) {
  if (!requestId || !delta || !src) {
    return;
  }
  const payload: AiStreamPayload = {
    delta,
    requestId,
  };
  if (src.tab?.id >= 0) {
    await sendTabCmd(src.tab.id, AI_STREAM_EVENT, payload, src.frameId >= 0 ? { [kFrameId]: src.frameId } : undefined);
    return;
  }
  await browser?.runtime
    ?.sendMessage({
      cmd: AI_STREAM_EVENT,
      data: payload,
    })
    .catch(ignoreNoReceiver);
}

function messageContentToText(content) {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => part?.text || part?.content || "")
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  return `${content || ""}`.trim();
}

function normalizeChatHistory(history) {
  return (Array.isArray(history) ? history : [])
    .filter((item) => item && (item.role === "user" || item.role === "assistant"))
    .slice(-MAX_HISTORY_MESSAGES)
    .map((item) => ({
      role: item.role,
      content: truncateText(item.content, MAX_HISTORY_MESSAGE_CHARS),
    }))
    .filter((item) => item.content);
}

function normalizePageIndex(page, src) {
  const url = `${page?.url || src?.url || ""}`.trim();
  return {
    url,
    title: truncateText(page?.title, 300),
    readyState: truncateText(page?.readyState, 40),
    language: truncateText(page?.language, 40),
    selectionPreview: truncateText(page?.selectionPreview, 500),
    counts: {
      forms: +page?.counts?.forms || 0,
      links: +page?.counts?.links || 0,
      buttons: +page?.counts?.buttons || 0,
      scripts: +page?.counts?.scripts || 0,
      iframes: +page?.counts?.iframes || 0,
    },
    landmarks: normalizeLandmarks(page?.landmarks),
    headings: normalizeHeadings(page?.headings),
    forms: normalizeForms(page?.forms),
    scripts: normalizePageScripts(page?.scripts),
  };
}

function normalizeLandmarks(landmarks) {
  const res = {};
  for (const key of ["main", "header", "nav", "footer", "article"]) {
    const value = truncateText(landmarks?.[key], 240);
    if (value) res[key] = value;
  }
  return res;
}

function normalizeHeadings(headings) {
  return (Array.isArray(headings) ? headings : [])
    .slice(0, 12)
    .map((item) => ({
      level: truncateText(item?.level, 20),
      selector: truncateText(item?.selector, 240),
      text: truncateText(item?.text, 240),
    }))
    .filter((item) => item.selector || item.text);
}

function normalizeForms(forms) {
  return (Array.isArray(forms) ? forms : [])
    .slice(0, 6)
    .map((item) => ({
      selector: truncateText(item?.selector, 240),
      action: truncateText(item?.action, 240),
      method: truncateText(item?.method, 20),
      fields: (Array.isArray(item?.fields) ? item.fields : [])
        .slice(0, 8)
        .map((field) => truncateText(field, 100))
        .filter(Boolean),
    }))
    .filter((item) => item.selector || item.action || item.fields.length);
}

function normalizePageScripts(scripts) {
  return (Array.isArray(scripts) ? scripts : [])
    .slice(0, 16)
    .map((item) => ({
      index: clampNumber(item?.index, 0, 999, 0),
      src: truncateText(item?.src, 500),
      type: truncateText(item?.type, 80),
      id: truncateText(item?.id, 120),
      async: item?.async ? true : undefined,
      defer: item?.defer ? true : undefined,
      module: item?.module ? true : undefined,
      inlineLength: clampNumber(item?.inlineLength, 0, 1e7, 0),
    }))
    .filter((item) => item.src || item.type || item.id || item.inlineLength || item.index >= 0);
}

function normalizeContextBlocks(blocks) {
  let total = 0;
  const res = [];
  for (const block of (Array.isArray(blocks) ? blocks : []).slice(-MAX_CONTEXT_BLOCKS)) {
    const normalized = normalizeContextBlock(block, MAX_CONTEXT_BLOCK_CHARS);
    if (!normalized) {
      continue;
    }
    total += normalized.content.length;
    if (total > MAX_CONTEXT_BLOCK_TOTAL_CHARS) {
      break;
    }
    res.push(normalized);
  }
  return res;
}

function normalizeContextBlock(block, maxChars) {
  const key = truncateText(block?.key, 240);
  const title = truncateText(block?.title, 240);
  const content = truncateText(block?.content, maxChars);
  if (!key || !title || !content) {
    return null;
  }
  return {
    key,
    title,
    mime: truncateText(block?.mime, 60) || "text/plain",
    content,
  };
}

function parseContextRequest(content) {
  content = `${content || ""}`.trim();
  if (!content) {
    return null;
  }
  let raw = JSON_BLOCK_RE.exec(content)?.[1];
  if (!raw && content.startsWith("{") && content.endsWith("}")) {
    raw = content;
  }
  if (!raw) {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) {
      raw = content.slice(start, end + 1);
    }
  }
  if (!raw) {
    return null;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (data?.type !== "context_request" || !Array.isArray(data.requests)) {
    return null;
  }
  const requests = data.requests
    .map(normalizeContextRequest)
    .filter(Boolean)
    .slice(0, MAX_CONTEXT_REQUESTS);
  return requests.length ? { requests } : null;
}

function normalizeContextRequest(request) {
  const kind = `${request?.kind || ""}`.trim();
  if (!kind) {
    return null;
  }
  if (kind === "searchHtml" || kind === "searchText" || kind === "searchScriptTags") {
    const query = truncateText(request.query, MAX_REQUEST_QUERY_CHARS);
    if (!query) {
      return null;
    }
    return {
      kind,
      query,
      maxMatches: clampNumber(request.maxMatches, 1, MAX_REQUEST_MATCHES, 3),
      contextChars: clampNumber(request.contextChars, 60, MAX_REQUEST_CONTEXT_CHARS, 160),
    };
  }
  if (kind === "getHtml" || kind === "getText") {
    const selector = truncateText(request.selector, MAX_REQUEST_SELECTOR_CHARS);
    if (!selector) {
      return null;
    }
    return {
      kind,
      selector,
      index: clampNumber(request.index, 0, 20, 0),
      maxChars: clampNumber(request.maxChars, 200, MAX_REQUEST_CHARS, 4000),
    };
  }
  if (kind === "getScriptTag") {
    return {
      kind,
      index: clampNumber(request.index, 0, 999, 0),
      maxChars: clampNumber(request.maxChars, 200, MAX_SCRIPT_SOURCE_CHARS, 6000),
    };
  }
  if (kind === "getSelection") {
    return {
      kind,
      maxChars: clampNumber(request.maxChars, 100, 4000, 1000),
    };
  }
  if (kind === "getUserscript") {
    return {
      kind,
      id: clampNumber(request.id, 1, 1e9, 0),
      maxChars: clampNumber(request.maxChars, 500, MAX_USERSCRIPT_CODE_CHARS, 6000),
    };
  }
  return null;
}

async function resolveBackgroundContextRequests(requests, pageIndex, matchedScripts, isTop) {
  const pageRequests = [];
  const contextBlocks = [];
  if (!requests.length) {
    return { pageRequests, contextBlocks };
  }
  contextBlocks.push(...(await resolveExternalScriptRequests(requests, pageIndex.scripts)));
  contextBlocks.push(
    ...(await resolveUserscriptRequests(requests, pageIndex.url, isTop, matchedScripts)),
  );
  for (const request of requests) {
    if (request.kind === "getUserscript") {
      continue;
    }
    if (request.kind === "getScriptTag" && pageIndex.scripts[request.index]?.src) {
      continue;
    }
    pageRequests.push(request);
  }
  return {
    pageRequests,
    contextBlocks: normalizeContextBlocks(contextBlocks),
  };
}

async function resolveExternalScriptRequests(requests, pageScripts) {
  const res = [];
  const seen = new Set();
  for (const request of requests) {
    if (request.kind !== "getScriptTag") {
      continue;
    }
    const script = pageScripts[request.index];
    if (!script?.src || seen.has(script.index)) {
      continue;
    }
    seen.add(script.index);
    let content;
    try {
      const response = await fetch(script.src);
      const body = await response.text();
      content = [
        "Metadata:",
        JSON.stringify(script, null, 2),
        "",
        "Source:",
        truncateText(body, request.maxChars),
        "",
        `HTTP ${response.status}${response.ok ? "" : " (non-OK)"}`,
      ].join("\n");
    } catch (err) {
      content = [
        "Metadata:",
        JSON.stringify(script, null, 2),
        "",
        `Failed to fetch external script source: ${err?.message || err}`,
      ].join("\n");
    }
    res.push({
      key: `external-script:${script.index}`,
      title: `External script tag #${script.index}`,
      mime: "text/javascript",
      content,
    });
  }
  return res;
}

async function resolveUserscriptRequests(requests, url, isTop, matchedScripts) {
  if (!url) {
    return [];
  }
  const ids = [] as number[];
  for (const request of requests) {
    if (request.kind === "getUserscript") {
      const id = clampNumber(request.id, 1, 1e9, 0);
      if (id) ids.push(id);
    }
  }
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) {
    return [];
  }
  const rawScripts = getMatchedScriptsRaw(url, isTop);
  const rawMap = rawScripts.reduce(
    (map, script) => {
      map[script.props.id] = script;
      return map;
    },
    {} as Record<number, VMScript>,
  );
  const codeMap = (await storage[S_CODE].getMulti(uniqueIds)) as Record<number, string>;
  return uniqueIds
    .map((id) => {
      const rawScript = rawMap[id];
      if (!rawScript) {
        return null;
      }
      const summary =
        matchedScripts.find((script) => script.id === id) || summarizeMatchedScript(rawScript);
      return {
        key: `userscript:${id}`,
        title: `Matched userscript #${id}: ${summary.name}`,
        mime: "text/javascript",
        content: [
          "Metadata:",
          JSON.stringify(summary, null, 2),
          "",
          "Code:",
          truncateText(
            codeMap[id],
            requests.find((request) => request.id === id)?.maxChars || MAX_USERSCRIPT_CODE_CHARS,
          ),
        ].join("\n"),
      };
    })
    .filter(Boolean);
}

function getMatchedUserscriptSummaries(url, isTop) {
  return getMatchedScriptsRaw(url, isTop)
    .slice(0, MAX_MATCHED_USERSCRIPTS)
    .map(summarizeMatchedScript);
}

function getMatchedScriptsRaw(url, isTop) {
  if (!url) {
    return [];
  }
  const env = getScriptsByURL(url, isTop, [], undefined);
  const rawScripts = [];
  const seen = new Set();
  for (const script of [...(env?.[SCRIPTS] || []), ...(env?.[MORE]?.[SCRIPTS] || [])]) {
    const id = script?.props?.id;
    if (id && !seen.has(id)) {
      seen.add(id);
      rawScripts.push(script);
    }
  }
  return rawScripts;
}

function summarizeMatchedScript(script) {
  const {
    config,
    custom,
    meta,
    props: { id },
  } = script;
  return {
    id,
    name: getScriptName(script),
    description: meta.description || "",
    runAt: getScriptRunAt(script),
    enabled: !!config.enabled,
    include: meta.include || [],
    match: meta.match || [],
    exclude: meta.exclude || [],
    excludeMatch: meta.excludeMatch || [],
    grant: meta.grant || [],
    injectInto: custom.injectInto || "",
  };
}

function clampNumber(value, min, max, fallback) {
  value = Number(value);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

function truncateText(text, limit) {
  text = `${text || ""}`.trim();
  if (!text || !limit || text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(limit - 24, 0)).trimEnd()}\n...[truncated]`;
}
