function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function transformObjectKeys(
  obj: Record<string, unknown>,
  transformer: (key: string) => string,
  deep = true,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const transformedKey = transformer(key);
    if (deep && isPlainObject(value)) {
      result[transformedKey] = transformObjectKeys(value, transformer, true);
    } else if (deep && Array.isArray(value)) {
      result[transformedKey] = value.map((item) =>
        isPlainObject(item) ? transformObjectKeys(item, transformer, true) : item,
      );
    } else {
      result[transformedKey] = value;
    }
  }
  return result;
}

export function objectToSnakeCase(obj: Record<string, unknown>, deep = true): Record<string, unknown> {
  return transformObjectKeys(obj, camelToSnake, deep);
}
