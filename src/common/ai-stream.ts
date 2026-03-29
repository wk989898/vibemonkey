export const AI_STREAM_EVENT = "AiStreamEvent";

export type AiStreamPayload = {
  delta: string;
  requestId: string;
};
