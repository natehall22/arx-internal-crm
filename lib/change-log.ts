/**
 * Change-log entries — ONE shape for every "who changed what" table (supplier_audit_log, service_plan_changes):
 * `changes = [{ field, label, old, new }]`. Client-safe.
 */
export type FieldChange = { field: string; label: string; old: unknown; new: unknown }

/** One line for a change-log screen. */
export function describeChange(c: FieldChange): string {
  const show = (v: unknown) =>
    Array.isArray(v) ? (v.length ? v.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : '(none)') : v === null || v === undefined || v === '' ? '(empty)' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return `${c.label}: ${show(c.old)} → ${show(c.new)}`
}

/**
 * JSON with object keys sorted, so two equal values compare equal however their keys were ordered (Postgres jsonb
 * re-orders keys on the way out). Array order is kept: it means something (steps run in order, tiers are offered in order).
 */
export function stableJson(v: unknown): string {
  return JSON.stringify(v ?? null, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x
  )
}

/** Pure: is this value the same as that one (deep, key order ignored; null / undefined equal)? */
export function sameValue(a: unknown, b: unknown): boolean {
  return stableJson(a ?? null) === stableJson(b ?? null)
}

/** Pure: the entries for the fields that differ (deep compare, key order inside objects ignored). */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>): FieldChange[] {
  const out: FieldChange[] = []
  for (const [field, label] of Object.entries(labels)) {
    if (!(field in after)) continue
    const a = before[field] ?? null
    const b = after[field] ?? null
    if (!sameValue(a, b)) out.push({ field, label, old: a, new: b })
  }
  return out
}
