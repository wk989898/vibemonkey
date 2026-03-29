import { jsonDump } from "@/injected/web/util";

test("jsonDump", () => {
  const sameChildObj = { foo: 1 };
  const sparseArray = [1, 2, 3, undefined];
  sparseArray.length = 6;
  sparseArray[5] = 4;
  for (const obj of [
    1,
    null,
    false,
    undefined,
    Infinity,
    NaN,
    "abc",
    {},
    [],
    sparseArray,
    {
      a: 1,
      b: "2",
      c: true,
      d: "aaa",
    },
    {
      a: [1, 2, 3],
      b: { a: '\\"\x01foo\r\t"\u2028\u2029' },
      skipped: undefined,
      unsupported: new Set(),
    },
    {
      sameChild1: sameChildObj,
      sameChild2: sameChildObj,
      sameChild3: [sameChildObj],
    },
  ]) {
    expect(jsonDump(obj, undefined)).toEqual(JSON.stringify(obj));
  }
  expect(() => {
    const cyclic: Record<string, unknown> = {};
    cyclic.foo = [1, 2, 3, { cyclic }];
    jsonDump(cyclic, undefined);
  }).toThrow(/Converting circular structure to JSON/);
});
