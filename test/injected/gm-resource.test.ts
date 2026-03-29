import { buffer2string } from "@/common";
import { decodeResource } from "@/injected/content/util";

const URLWithCache = URL as typeof URL & { blobCache: Record<string, Blob> };

const stringAsBase64 = (str: string) => btoa(buffer2string(new TextEncoder().encode(str).buffer));

const blobAsText = async (blob: Blob) =>
  new Promise<string>((resolve) => {
    const fr = new FileReader();
    fr.onload = () => {
      const result = fr.result;
      resolve(
        typeof result === "string" ? result : new TextDecoder().decode(result as ArrayBuffer),
      );
    };
    fr.readAsArrayBuffer(blob);
  });

// WARNING: don't include D800-DFFF range which is for surrogate pairs
const RESOURCE_TEXT = "abcd\u1234\u2345\u3456\u4567\u5678\u6789\u789A\u89AB\u9ABC\uABCD";
const DATA = `text/plain,${stringAsBase64(RESOURCE_TEXT)}`;
const DATA_URL = `data:${DATA.replace(",", ";base64,")}`;

test("@resource decoding", async () => {
  expect(decodeResource(DATA, undefined)).toEqual(RESOURCE_TEXT);
  expect(await blobAsText(URLWithCache.blobCache[decodeResource(DATA, true)])).toEqual(
    RESOURCE_TEXT,
  );
  expect(decodeResource(DATA, false)).toEqual(DATA_URL);
});
