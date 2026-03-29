type ObjectKey = string | string[] | number | null | undefined;
type PlainObject = Record<string, any>;

let deepDiff = false;

export function normalizeKeys(key: ObjectKey): string[] {
  if (key == null) return [];
  if (Array.isArray(key)) return key;
  return `${key}`.split(".").filter(Boolean);
}

export function objectGet<T = unknown>(obj: unknown, rawKey: ObjectKey) {
  let current = obj as PlainObject | null | undefined;
  for (const key of normalizeKeys(rawKey)) {
    if (!current || typeof current !== "object") break;
    current = current[key];
  }
  return current as T;
}

export function objectSet(
  obj: PlainObject | null | undefined,
  rawKey: ObjectKey,
  val?: unknown,
  retParent?: boolean,
) {
  const keys = normalizeKeys(rawKey);
  const root = obj || {};
  let res = root as PlainObject;
  let key = "";
  for (let i = 0; (key = keys[i]), i < keys.length - 1; i += 1) {
    res = res[key] || (res[key] = {});
  }
  if (!keys.length) return root;
  if (val === undefined) {
    delete res[key];
  } else {
    res[key] = val;
  }
  return retParent ? res : root;
}

export function objectPick(
  obj: PlainObject | null | undefined,
  keys: string[],
  transform?: (value: unknown, key: string) => unknown,
) {
  const res: PlainObject = {};
  for (const key of keys) {
    let value = obj?.[key];
    if (transform) value = transform(value, key);
    if (value !== undefined) res[key] = value;
  }
  return res;
}

export function mapEntry(
  this: PlainObject,
  fnValue?: (value: unknown, newKey: string, obj: PlainObject) => unknown,
  fnKey?: (key: string, value: unknown, obj: PlainObject) => string | undefined,
  thisObj?: unknown,
) {
  const res: PlainObject = {};
  for (const key of Object.keys(this)) {
    const val = this[key];
    const newKey = fnKey?.call(thisObj, key, val, this) || key;
    if (newKey) {
      res[newKey] = fnValue ? fnValue.call(thisObj, val, newKey, this) : val;
    }
  }
  return res;
}

// invoked as forEachEntry.call(obj, ([key, value], i, allEntries) => {})
export function forEachEntry(
  this: PlainObject | null | undefined,
  func: (entry: [string, unknown], index: number, entries: [string, unknown][]) => void,
  thisObj?: unknown,
) {
  if (this) Object.entries(this).forEach(func, thisObj);
}

// invoked as forEachKey.call(obj, key => {}, i, allKeys)
export function forEachKey(
  this: PlainObject | null | undefined,
  func: (key: string, index: number, keys: string[]) => void,
  thisObj?: unknown,
) {
  if (this) Object.keys(this).forEach(func, thisObj);
}

// invoked as forEachValue.call(obj, value => {}, i, allValues)
export function forEachValue(
  this: PlainObject | null | undefined,
  func: (value: unknown, index: number, values: unknown[]) => void,
  thisObj?: unknown,
) {
  if (this) Object.values(this).forEach(func, thisObj);
}

export function deepCopy<T>(src: T): T {
  if (!src || typeof src !== "object") return src;
  // Using a literal [] instead of `src.map(deepCopy)` to avoid src `window` leaking.
  // Using `concat` instead of `for` loop to preserve holes in the array.
  if (Array.isArray(src)) return [].concat(src).map(deepCopy) as T;
  return mapEntry.call(src as PlainObject, deepCopy) as T;
}

// Simplified deep equality checker
export function deepEqual(a: unknown, b: unknown) {
  let res;
  if (!a || !b || typeof a !== typeof b || typeof a !== "object") {
    res = a === b;
  } else if (Array.isArray(a)) {
    const arrB = b as unknown[];
    res = a.length === arrB.length && a.every((item, i) => deepEqual(item, arrB[i]));
  } else {
    const objA = a as PlainObject;
    const objB = b as PlainObject;
    const keysA = Object.keys(objA);
    /* Not checking hasOwnProperty because 1) we only use own properties and
     * 2) this can be slow for a large value storage that has thousands of keys */
    res =
      keysA.length === Object.keys(objB).length &&
      keysA.every((key) => deepEqual(objA[key], objB[key]));
  }
  return res;
}

export function deepCopyDiff<T>(src: T, sample: unknown) {
  if (src === sample) return;
  if (!src || typeof src !== "object") return src;
  if (!sample || typeof sample !== "object") return deepCopy(src);
  deepDiff = false;
  src = (
    Array.isArray(src)
      ? deepCopyDiffArrays(src, sample as unknown[])
      : deepCopyDiffObjects(src as PlainObject, sample as PlainObject)
  ) as T;
  if (deepDiff) return src;
}

function deepCopyDiffArrays<T>(src: T[], sample: unknown[]) {
  const res: T[] = [];
  if (src.length !== sample.length) {
    deepDiff = true;
  }
  for (let i = 0, a, b; i < src.length; i++) {
    a = src[i];
    b = sample[i];
    if (a && typeof a === "object") {
      if (b && typeof b === "object") {
        a = Array.isArray(a)
          ? deepCopyDiffArrays(a, b as unknown[])
          : deepCopyDiffObjects(a as PlainObject, b as PlainObject);
      } else {
        a = deepCopy(a);
        deepDiff = true;
      }
    } else if (a !== b) {
      deepDiff = true;
    }
    res[i] = a as T;
  }
  return res;
}

function deepCopyDiffObjects<T extends PlainObject>(src: T, sample: PlainObject) {
  const res = {} as T;
  for (const key in sample) {
    if (!hasOwnProperty(src, key)) {
      deepDiff = true;
      break;
    }
  }
  for (const key in src) {
    /* Not using Object.keys and not checking hasOwnProperty because we only use own properties,
     * and this can be very slow for a large value storage that has thousands of keys */
    let a: any = src[key];
    let b = sample[key];
    if (a && typeof a === "object") {
      if (b && typeof b === "object") {
        a = Array.isArray(a)
          ? deepCopyDiffArrays(a, b as unknown[])
          : deepCopyDiffObjects(a as PlainObject, b as PlainObject);
      } else {
        a = deepCopy(a);
        deepDiff = true;
      }
    } else if (a !== b) {
      deepDiff = true;
    }
    res[key] = a;
  }
  return res;
}

export function deepSize(val: unknown) {
  if (val === undefined) return 0;
  if (val === true || val == null) return 4;
  if (val === false) return 5;
  if (typeof val === "string") return val.length + 2; // not counting escapes for \n\r\t and so on
  if (typeof val !== "object") return `${val}`.length; // number and whatever
  if (Array.isArray(val)) return val.reduce((sum, v) => sum + 1 + deepSize(v), 2);
  return Object.keys(val).reduce((sum, k) => sum + k.length + 4 + deepSize(val[k]), 2);
}

export function nest(obj: PlainObject, key: string) {
  return obj[key] || (obj[key] = {});
}
