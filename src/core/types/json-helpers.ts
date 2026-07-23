// Type guards for narrowing `unknown` values at JSON boundaries.
// Every external JSON parse site should pass through one of these before
// the value enters typed code.

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function hasStringProp(v: object, k: string): v is Record<string, string> & typeof v {
  return k in v && typeof (v as Record<string, unknown>)[k] === 'string';
}

export function hasNumberProp(v: object, k: string): v is Record<string, number> & typeof v {
  return k in v && typeof (v as Record<string, unknown>)[k] === 'number';
}

export function hasArrayProp(v: object, k: string): v is Record<string, unknown[]> & typeof v {
  return k in v && Array.isArray((v as Record<string, unknown>)[k]);
}

export function hasProp<T extends object>(v: unknown, k: string): v is T {
  return isRecord(v) && k in v;
}

export function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Narrow unknown to a typed record with required string fields. Throws on mismatch. */
export function requireRecord(v: unknown, context: string): Record<string, unknown> {
  if (!isRecord(v)) {
    throw new Error(`Expected JSON object for ${context}, got ${typeof v}`);
  }
  return v;
}
