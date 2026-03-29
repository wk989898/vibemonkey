import { expect, test } from "vitest";
import {
  createAiResponseStreamParser,
  getAiTextDelta,
  parseAiResponseBody,
} from "@/background/utils/ai-response";

test("parseAiResponseBody keeps JSON responses intact", () => {
  expect(parseAiResponseBody('{"choices":[{"message":{"content":"hello"}}]}')).toEqual({
    choices: [{ message: { content: "hello" } }],
  });
});

test("parseAiResponseBody wraps plain text success bodies", () => {
  expect(parseAiResponseBody("plain text reply")).toEqual({
    choices: [{ message: { content: "plain text reply" } }],
  });
});

test("parseAiResponseBody reconstructs chat-completions style stream output", () => {
  const data = parseAiResponseBody(`\
data: {"choices":[{"delta":{"content":"Hel"}}]}
data: {"choices":[{"delta":{"content":"lo"}}]}
data: [DONE]
`);
  expect(data).toEqual({
    choices: [{ message: { content: "Hello" } }],
  });
});

test("parseAiResponseBody reconstructs responses style stream output", () => {
  const data = parseAiResponseBody(`\
data: {"type":"response.output_text.delta","delta":"Hi"}
data: {"type":"response.output_text.delta","delta":" there"}
data: [DONE]
`);
  expect(data).toEqual({
    choices: [{ message: { content: "Hi there" } }],
  });
});

test("parseAiResponseBody deduplicates cumulative stream payloads", () => {
  const data = parseAiResponseBody(`\
data: {"output_text":"Hello"}
data: {"output_text":"Hello world"}
data: [DONE]
`);
  expect(data).toEqual({
    choices: [{ message: { content: "Hello world" } }],
  });
});

test("getAiTextDelta extracts text from responses payloads", () => {
  expect(
    getAiTextDelta({
      output: [
        {
          content: [{ text: "done" }],
        },
      ],
    }),
  ).toBe("done");
});

test("createAiResponseStreamParser emits incremental SSE deltas", () => {
  const parser = createAiResponseStreamParser("text/event-stream");
  expect(parser.push('data: {"choices":[{"delta":{"content":"Hel"}}]}\n')).toBe("Hel");
  expect(parser.push('data: {"choices":[{"delta":{"content":"lo"}}]}\n')).toBe("lo");
  expect(parser.finish().data).toEqual({
    choices: [{ message: { content: "Hello" } }],
  });
});

test("createAiResponseStreamParser avoids duplicating cumulative text chunks", () => {
  const parser = createAiResponseStreamParser("text/event-stream");
  expect(parser.push('data: {"output_text":"Hello"}\n')).toBe("Hello");
  expect(parser.push('data: {"output_text":"Hello world"}\n')).toBe(" world");
  expect(parser.finish().data).toEqual({
    choices: [{ message: { content: "Hello world" } }],
  });
});
