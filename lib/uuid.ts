/** A real UUID (8-4-4-4-12 hex), not just 36 hex-or-dash characters. Client-safe; the one copy of this check. */
export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
