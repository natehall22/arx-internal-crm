/**
 * Send-any-PDF vocabulary and the pure rules around it (client-safe, no imports). A request is a PDF + roles (who signs, in
 * what order) + fields placed on its pages. Positions are FRACTIONS of the page (0..1, from the top-left), so a field lands
 * in the same place at any zoom, on a phone or a desktop, and in the stamped PDF.
 */

export const FIELD_KINDS = ['signature', 'initials', 'date', 'text', 'checkbox', 'name'] as const
export type FieldKind = (typeof FIELD_KINDS)[number]

export const FIELD_LABELS: Record<FieldKind, string> = {
  signature: 'Signature',
  initials: 'Initials',
  date: 'Date signed',
  text: 'Text',
  checkbox: 'Checkbox',
  name: 'Full name',
}

/** Default size (fraction of page width / height) a field gets when it is tapped onto a page. */
export const DEFAULT_FIELD_SIZE: Record<FieldKind, { w: number; h: number }> = {
  signature: { w: 0.32, h: 0.06 },
  initials: { w: 0.1, h: 0.05 },
  date: { w: 0.18, h: 0.03 },
  text: { w: 0.3, h: 0.03 },
  checkbox: { w: 0.03, h: 0.025 },
  name: { w: 0.28, h: 0.03 },
}

export const LIMITS = {
  maxPdfBytes: 15 * 1024 * 1024,
  maxPages: 60,
  maxRoles: 5,
  maxFields: 150,
  maxBulk: 100,
  maxTitle: 120,
  maxMessage: 1000,
  minExpiryDays: 1,
  maxExpiryDays: 60,
  defaultExpiryDays: 14,
} as const

export type RoleDef = { key: string; label: string; order: number }
export type PlacedField = { id: string; roleKey: string; kind: FieldKind; page: number; x: number; y: number; w: number; h: number; required: boolean; label?: string }
export type SigningOrder = 'parallel' | 'serial'

const KEY_RE = /^[a-z][a-z0-9_]{0,23}$/
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max)

/** "Tenant 2" -> "tenant_2": a stable key for a role (the label is what people see). */
export function roleKeyFrom(label: string, taken: ReadonlySet<string> = new Set()): string {
  const base = clean(label, 40).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '') || 'signer'
  let key = base.slice(0, 20)
  let n = 2
  while (taken.has(key)) key = `${base.slice(0, 18)}_${n++}`
  return key
}

export function cleanRoles(input: unknown): RoleDef[] | { error: string } {
  if (!Array.isArray(input) || input.length === 0) return { error: 'Add at least one signer' }
  if (input.length > LIMITS.maxRoles) return { error: `At most ${LIMITS.maxRoles} signers` }
  const seen = new Set<string>()
  const out: RoleDef[] = []
  for (let i = 0; i < input.length; i++) {
    const r = (input[i] ?? {}) as Record<string, unknown>
    const label = clean(r.label, 40)
    const key = clean(r.key, 24)
    if (!label) return { error: 'Every signer needs a label' }
    if (!KEY_RE.test(key) || seen.has(key)) return { error: 'Each signer needs its own key' }
    seen.add(key)
    out.push({ key, label, order: i })
  }
  return out
}

/**
 * The fields of a request, checked against its roles and page count. Every signer must have at least one signature field
 * (a signer with nothing to sign is a mistake, not a signer). Positions must sit on the page; sizes are bounded.
 */
export function cleanFields(input: unknown, roles: readonly RoleDef[], pageCount: number): PlacedField[] | { error: string } {
  if (!Array.isArray(input) || input.length === 0) return { error: 'Place at least one field on the document' }
  if (input.length > LIMITS.maxFields) return { error: `At most ${LIMITS.maxFields} fields` }
  const roleKeys = new Set(roles.map((r) => r.key))
  const ids = new Set<string>()
  const out: PlacedField[] = []
  for (const raw of input) {
    const f = (raw ?? {}) as Record<string, unknown>
    const id = clean(f.id, 64)
    if (!id || ids.has(id)) return { error: 'A field is missing its id' }
    ids.add(id)
    if (!FIELD_KINDS.includes(f.kind as FieldKind)) return { error: 'Unknown field type' }
    if (!roleKeys.has(String(f.roleKey))) return { error: 'A field belongs to a signer that is not on this document' }
    if (!Number.isInteger(f.page) || (f.page as number) < 0 || (f.page as number) >= pageCount) return { error: 'A field is not on a page of this document' }
    const { x, y, w, h } = f as Record<string, unknown>
    if (![x, y, w, h].every(isNum)) return { error: 'A field has no position' }
    const [fx, fy, fw, fh] = [x, y, w, h] as number[]
    if (fw < 0.01 || fh < 0.01 || fw > 1 || fh > 1) return { error: 'A field is the wrong size' }
    if (fx < 0 || fy < 0 || fx + fw > 1.0001 || fy + fh > 1.0001) return { error: 'A field hangs off the page' }
    const label = clean(f.label, 60)
    out.push({ id, roleKey: String(f.roleKey), kind: f.kind as FieldKind, page: f.page as number, x: fx, y: fy, w: fw, h: fh, required: f.required !== false, ...(label ? { label } : {}) })
  }
  for (const r of roles) {
    if (!out.some((f) => f.roleKey === r.key && f.kind === 'signature')) return { error: `${r.label} needs a signature field` }
  }
  return out
}

export type SignerLite = { id: string; role_key: string; order_index: number; status: string }

/** Whose turn it is. Parallel: everyone who has not signed. Serial: only the lowest-order signers still pending. */
export function canSignNow(order: SigningOrder, signers: readonly SignerLite[], signerId: string): boolean {
  const me = signers.find((s) => s.id === signerId)
  if (!me || me.status === 'signed' || me.status === 'declined') return false
  if (order === 'parallel') return true
  return !signers.some((s) => s.order_index < me.order_index && s.status !== 'signed')
}

/** The signers to email next after `justSigned` signed (serial: the next ones in line; parallel: nobody, all were notified at send). */
export function nextToNotify(order: SigningOrder, signers: readonly SignerLite[], justSigned: string): SignerLite[] {
  if (order !== 'serial') return []
  const after = signers.map((s) => (s.id === justSigned ? { ...s, status: 'signed' } : s))
  const pending = after.filter((s) => s.status !== 'signed' && s.status !== 'declined')
  if (pending.length === 0) return []
  const lowest = Math.min(...pending.map((s) => s.order_index))
  return pending.filter((s) => s.order_index === lowest)
}

export type FieldValue = string | boolean | null | undefined

/**
 * What a signer still owes before they can finish: required fields of THEIR role that are empty. Signature / initials are
 * satisfied by the adopted signature / initials; date and name fill themselves.
 */
export function missingFields(fields: readonly PlacedField[], roleKey: string, values: Record<string, FieldValue>, adopted: { signature: boolean; initials: boolean }): PlacedField[] {
  return fields.filter((f) => {
    if (f.roleKey !== roleKey || !f.required) return false
    if (f.kind === 'signature') return !adopted.signature
    if (f.kind === 'initials') return !adopted.initials
    if (f.kind === 'date' || f.kind === 'name') return false
    if (f.kind === 'checkbox') return values[f.id] !== true
    return !String(values[f.id] ?? '').trim()
  })
}

/** Reading order for "next field": page, then top to bottom, then left to right. */
export function byReadingOrder<T extends { page: number; x: number; y: number }>(fields: readonly T[]): T[] {
  return [...fields].sort((a, b) => a.page - b.page || Math.round(a.y * 200) - Math.round(b.y * 200) || a.x - b.x)
}
