/**
 * What a crew checks off on a visit — the pure rules (client-safe, no I/O). The list comes from what was SOLD: the plan's
 * `service_lines` ("Mow", "Edge", "Blow", "Beds"; copied from its template at sale, editable per plan). What the crew has
 * checked is stored on the visit (`work_orders.visit_checklist`, [{ label, done }]) so the office sees it afterwards.
 * Prices are never part of it. Server side: lib/visit-checklist-db.ts. Migration 202611240030.
 */

export type ChecklistItem = { label: string; done: boolean }

export const MAX_SERVICE_LINES = 30
export const MAX_LINE_LENGTH = 60
/** What one visit may store (work_orders.visit_checklist CHECK, migration 202611240030): the plan's lines plus checked ones the office has since removed. */
export const MAX_VISIT_CHECKLIST = 40

const keyOf = (label: string) => label.trim().toLowerCase()

/**
 * A plan's / template's service lines from a form or API body: an array of strings, or one text with a line per service.
 * Trimmed, blanks and repeats (any case) dropped, order kept. Too many or too long → why not.
 */
export function cleanServiceLines(input: unknown): { ok: true; value: string[] } | { ok: false; error: string } {
  if (input === null || input === undefined || input === '') return { ok: true, value: [] }
  const raw = typeof input === 'string' ? input.split(/\r?\n/) : Array.isArray(input) ? input : null
  if (!raw) return { ok: false, error: 'What’s included must be a list' }
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') return { ok: false, error: 'What’s included must be a list' }
    const label = item.replace(/\s+/g, ' ').trim()
    if (!label) continue
    if (label.length > MAX_LINE_LENGTH) return { ok: false, error: `Keep each service under ${MAX_LINE_LENGTH} letters` }
    if (seen.has(keyOf(label))) continue
    seen.add(keyOf(label))
    out.push(label)
  }
  if (out.length > MAX_SERVICE_LINES) return { ok: false, error: `At most ${MAX_SERVICE_LINES} services per plan` }
  return { ok: true, value: out }
}

/** Reads whatever the database holds (never throws): strings only, as the plan's lines. */
export function readServiceLines(raw: unknown): string[] {
  const r = cleanServiceLines(Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [])
  return r.ok ? r.value : []
}

/** Reads the stored state of a visit (never throws). */
export function readChecklist(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) return []
  const out: ChecklistItem[] = []
  const seen = new Set<string>()
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const label = typeof (x as { label?: unknown }).label === 'string' ? (x as { label: string }).label.trim().slice(0, MAX_LINE_LENGTH) : ''
    if (!label || seen.has(keyOf(label))) continue
    seen.add(keyOf(label))
    out.push({ label, done: (x as { done?: unknown }).done === true })
  }
  return out
}

/**
 * The list a crew sees for a visit. Still to do: the plan's CURRENT lines in the plan's order, each with whatever was
 * already checked (a line the office added since shows unchecked; one it removed disappears unless the crew had already
 * checked it, which stays so the record is true). Finished: exactly what was stored when it was finished.
 */
export function visitChecklist(planLines: string[], stored: ChecklistItem[], open: boolean): ChecklistItem[] {
  if (!open) return stored
  const done = new Map(stored.map((s) => [keyOf(s.label), s.done]))
  const out: ChecklistItem[] = planLines.map((label) => ({ label, done: done.get(keyOf(label)) === true }))
  const have = new Set(out.map((o) => keyOf(o.label)))
  for (const s of stored) if (s.done && !have.has(keyOf(s.label))) out.push({ label: s.label, done: true })
  // Never more than the column allows, or the tap / Done save would fail on the CHECK (plan lines come first and are kept).
  return out.slice(0, MAX_VISIT_CHECKLIST)
}

/** Pure: one tap. The label must be on the visit's list (the page and a tampered request alike). */
export function tapChecklist(current: ChecklistItem[], label: unknown, done: unknown): { ok: true; value: ChecklistItem[] } | { ok: false; error: string } {
  if (typeof label !== 'string' || typeof done !== 'boolean') return { ok: false, error: 'Tap a service to check it' }
  const k = keyOf(label)
  if (!current.some((c) => keyOf(c.label) === k)) return { ok: false, error: 'That service isn’t on this visit' }
  return { ok: true, value: current.map((c) => (keyOf(c.label) === k ? { ...c, done } : c)) }
}

export const unchecked = (list: ChecklistItem[]): ChecklistItem[] => list.filter((c) => !c.done)

/** The sentence under a finished visit for the office: "Mow, Edge · Not done: Blow". */
export function checklistSummary(list: ChecklistItem[]): string {
  if (list.length === 0) return ''
  const yes = list.filter((c) => c.done).map((c) => c.label)
  const no = unchecked(list).map((c) => c.label)
  return [yes.length ? yes.join(', ') : 'Nothing checked', no.length && yes.length ? `Not done: ${no.join(', ')}` : ''].filter(Boolean).join(' · ')
}
