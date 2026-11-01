/** Shapes that arrive as JSON over HTTP stay `unknown` until narrowed here. */
export type JsonRecord = Record<string, unknown>;

export function object(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

export function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
