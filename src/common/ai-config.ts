export const DEFAULT_AI_API_URL = "https://api.openai.com/v1/chat/completions";
export const DEFAULT_AI_MODEL = "gpt-5.2";

export type AiApiStyle = "chat_completions" | "responses";

type AiEndpoint = {
  apiStyle: AiApiStyle;
  apiUrl: string;
};

const CHAT_COMPLETIONS_PATH_RE = /\/chat\/completions\/?$/i;
const RESPONSES_PATH_RE = /\/responses\/?$/i;
const ROOT_API_VERSION_PATH_RE = /^\/v\d+$/i;

export function resolveAiEndpoint(rawUrl?: unknown): AiEndpoint {
  const input = `${rawUrl || DEFAULT_AI_API_URL}`.trim() || DEFAULT_AI_API_URL;
  let url: URL;
  try {
    url = new URL(input);
  } catch (error) {
    throw new Error("AI API URL is not a valid absolute URL.");
  }
  let path = url.pathname.replace(/\/+$/, "") || "";
  if (!path || path === "/") {
    path = "/v1/chat/completions";
  } else if (ROOT_API_VERSION_PATH_RE.test(path)) {
    path += "/chat/completions";
  }
  if (RESPONSES_PATH_RE.test(path)) {
    url.pathname = path;
    return {
      apiStyle: "responses",
      apiUrl: url.toString(),
    };
  }
  url.pathname = path;
  return {
    apiStyle: "chat_completions",
    apiUrl: url.toString(),
  };
}

export function getAiApiUrlError(rawUrl?: unknown): string | null {
  try {
    resolveAiEndpoint(rawUrl);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : `${error}`;
  }
}
