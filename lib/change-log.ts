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

/** Pure: the entries for the fields that differ (deep compare via JSON; key order inside objects matters). */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>): FieldChange[] {
  const out: FieldChange[] = []
  for (const [field, label] of Object.entries(labels)) {
    if (!(field in after)) continue
    const a = before[field] ?? null
    const b = after[field] ?? null
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field, label, old: a, new: b })
  }
  return out
}
