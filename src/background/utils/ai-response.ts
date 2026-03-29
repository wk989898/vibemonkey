const EVENT_STREAM_RE = /\btext\/event-stream\b/i;
const HTML_LIKE_RE = /^\s*<(?:!doctype|html|body)\b/i;
const JSON_CONTENT_TYPE_RE = /\b(?:application|text)\/(?:[\w.+-]*\+)?json\b/i;
const JSON_LIKE_RE = /^\s*[{\[]/;
const PLAIN_CONTENT_TYPE_RE = /\btext\/(?!event-stream\b|html\b)[^;]+/i;

type AiStreamParserMode = "auto" | "json" | "plain" | "sse";

type AiStreamParseResult = {
  data: Record<string, any> | null;
  errorMessage: string;
  raw: string;
  text: string;
};

export function parseAiResponseBody(raw: string): Record<string, any> | null {
  return parseAiResponseText(`${raw || ""}`.trim());
}

export function createAiResponseStreamParser(contentType = "") {
  let buffer = "";
  let errorMessage = "";
  let mode: AiStreamParserMode = getInitialParserMode(contentType);
  let raw = "";
  let text = "";

  const pushText = (value: string) => {
    const delta = getIncrementalText(text, value);
    if (delta) {
      text += delta;
    }
    return delta;
  };

  const handlePayload = (payload: string) => {
    if (!payload || payload === "[DONE]") {
      return "";
    }
    const data = tryParseJson(payload);
    if (data) {
      errorMessage ||= getAiErrorMessage(data);
      return pushText(getAiTextDelta(data));
    }
    return HTML_LIKE_RE.test(payload) ? "" : pushText(payload);
  };

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return "";
    }
    if (trimmed.startsWith("event:")) {
      mode = "sse";
      return "";
    }
    if (trimmed.startsWith("data:")) {
      mode = "sse";
      return handlePayload(trimmed.slice(5).trim());
    }
    if (mode === "sse") {
      return handlePayload(trimmed);
    }
    if (mode === "auto" && !JSON_LIKE_RE.test(trimmed)) {
      mode = "plain";
      const pending = buffer ? `${line}\n${buffer}` : line;
      buffer = "";
      return pushText(pending);
    }
    return mode === "json" || mode === "auto" ? "" : pushText(line);
  };

  return {
    push(chunk: string) {
      const normalized = `${chunk || ""}`;
      if (!normalized) {
        return "";
      }
      raw += normalized;
      if (mode === "plain") {
        return pushText(normalized);
      }
      buffer += normalized;
      if (mode === "auto") {
        const trimmed = buffer.trimStart();
        if (trimmed) {
          if (trimmed.startsWith("data:") || trimmed.startsWith("event:")) {
            mode = "sse";
          } else if (!JSON_LIKE_RE.test(trimmed) && !buffer.includes("\n")) {
            mode = "plain";
            const pending = buffer;
            buffer = "";
            return pushText(pending);
          }
        }
      }
      let delta = "";
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }
        delta += handleLine(line);
      }
      return delta;
    },
    finish(): AiStreamParseResult {
      let delta = "";
      if (buffer) {
        delta = mode === "plain" ? pushText(buffer) : handleLine(buffer);
        buffer = "";
      }
      return {
        data: parseAiResponseText(raw.trim()),
        errorMessage,
        raw,
        text,
      };
    },
  };
}

export function getAiTextDelta(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "";
  }
  const record = data as Record<string, any>;
  if (typeof record.output_text === "string") {
    return record.output_text;
  }
  if (typeof record.delta === "string") {
    return record.delta;
  }
  if (typeof record.text === "string" && /(?:output_text|message|delta)/i.test(`${record.type || ""}`)) {
    return record.text;
  }
  const choice = record.choices?.[0];
  const choiceDelta = joinContentParts(choice?.delta?.content);
  if (choiceDelta) {
    return choiceDelta;
  }
  const choiceMessage = joinContentParts(choice?.message?.content);
  if (choiceMessage) {
    return choiceMessage;
  }
  const output = Array.isArray(record.output) ? record.output : [];
  const outputText = output
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((part) => `${part?.text || part?.content || ""}`)
    .filter(Boolean)
    .join("");
  return outputText;
}

export function getAiErrorMessage(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "";
  }
  const record = data as Record<string, any>;
  const message =
    record.error?.message ||
    (typeof record.error === "string" ? record.error : "") ||
    (typeof record.message === "string" && /error/i.test(`${record.type || ""}`)
      ? record.message
      : "");
  return `${message || ""}`.trim();
}

function parseAiResponseText(text: string): Record<string, any> | null {
  if (!text || HTML_LIKE_RE.test(text)) {
    return null;
  }
  const json = tryParseJson(text);
  if (json) {
    return json;
  }
  const streamText = parseAiStreamText(text);
  if (streamText) {
    return wrapAiText(streamText);
  }
  return wrapAiText(text);
}

function parseAiStreamText(text: string): string | null {
  let output = "";
  let sawStreamChunk = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const payload = trimmed.startsWith("data:")
      ? trimmed.slice(5).trim()
      : trimmed.startsWith("{")
        ? trimmed
        : "";
    if (!payload || payload === "[DONE]") {
      continue;
    }
    sawStreamChunk = true;
    const chunk = tryParseJson(payload);
    if (chunk) {
      const delta = getIncrementalText(output, getAiTextDelta(chunk));
      if (delta) {
        output += delta;
      }
    } else if (!HTML_LIKE_RE.test(payload)) {
      output += getIncrementalText(output, payload);
    }
  }
  const textOut = output.trim();
  return sawStreamChunk && textOut ? textOut : null;
}

function getIncrementalText(current: string, next: string): string {
  next = `${next || ""}`;
  if (!next) {
    return "";
  }
  if (!current) {
    return next;
  }
  if (next.startsWith(current)) {
    return next.slice(current.length);
  }
  if (current.endsWith(next)) {
    return "";
  }
  return next;
}

function getInitialParserMode(contentType: string): AiStreamParserMode {
  if (EVENT_STREAM_RE.test(contentType)) {
    return "sse";
  }
  if (JSON_CONTENT_TYPE_RE.test(contentType)) {
    return "json";
  }
  if (PLAIN_CONTENT_TYPE_RE.test(contentType)) {
    return "plain";
  }
  return "auto";
}

function joinContentParts(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => `${part?.text || part?.content || ""}`)
    .filter(Boolean)
    .join("");
}

function tryParseJson(text: string): Record<string, any> | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function wrapAiText(text: string): Record<string, any> {
  return {
    choices: [
      {
        message: {
          content: text,
        },
      },
    ],
  };
}
