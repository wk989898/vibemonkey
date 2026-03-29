import { expect, test } from "vitest";
import { DEFAULT_AI_API_URL, getAiApiUrlError, resolveAiEndpoint } from "@/common/ai-config";

test("resolveAiEndpoint uses the default OpenAI chat completions endpoint", () => {
  expect(resolveAiEndpoint()).toEqual({
    apiStyle: "chat_completions",
    apiUrl: DEFAULT_AI_API_URL,
  });
});

test("resolveAiEndpoint expands a base /v1 URL to chat completions", () => {
  expect(resolveAiEndpoint("https://api.openai.com/v1")).toEqual({
    apiStyle: "chat_completions",
    apiUrl: "https://api.openai.com/v1/chat/completions",
  });
});

test("resolveAiEndpoint preserves responses endpoints", () => {
  expect(resolveAiEndpoint("https://api.openai.com/v1/responses")).toEqual({
    apiStyle: "responses",
    apiUrl: "https://api.openai.com/v1/responses",
  });
});

test("resolveAiEndpoint preserves custom third-party codex paths", () => {
  expect(resolveAiEndpoint("https://example.com/job/codex/v1")).toEqual({
    apiStyle: "chat_completions",
    apiUrl: "https://example.com/job/codex/v1",
  });
});

test("getAiApiUrlError still rejects malformed URLs", () => {
  expect(getAiApiUrlError("not-a-url")).toMatch(/valid absolute URL/i);
});
