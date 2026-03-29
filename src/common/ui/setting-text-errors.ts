export function normalizeBgError(err: unknown): string | string[] | null {
  let message: unknown;
  if (typeof err === "string" || Array.isArray(err)) {
    message = err;
  } else if (err && typeof err === "object" && "message" in err) {
    message = (err as { message?: unknown }).message;
  } else {
    return null;
  }
  if (typeof message === "string") {
    try {
      message = JSON.parse(message);
    } catch {
      /**/
    }
  }
  if (Array.isArray(message)) {
    if (message.length === 0) {
      return null;
    }
    return message.length === 1 ? `${message[0]}` : message.map((item) => `${item}`);
  }
  return message == null ? null : `${message}`;
}
