/**
 * Supplier records (the `vendors` table as the ordering flow uses it): who may edit them, how an edit is
 * validated, and how a change is described for the change log. One module for the API, the page and tests.
 */
import { isSuperAdmin, type SuperAdminProfile } from '@/lib/super-admin'
/** ASCII-only, one address, max 254 chars. Stricter than the mailer's check on purpose: this is what we STORE. */
const STORED_EMAIL_RE = /^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/
export const isStorableEmail = (v: string): boolean => v.length <= 254 && STORED_EMAIL_RE.test(v)

/** Owners only: a super admin, or the `owner` role. Supplier emails decide where job addresses are sent. */
export function canManageSuppliers(profile: (SuperAdminProfile & { role?: string | null }) | null | undefined): boolean {
  if (!profile) return false
  return isSuperAdmin(profile) || (profile.active !== false && String(profile.role || '').toLowerCase() === 'owner')
}

export type SupplierInput = {
  name: string
  active: boolean
  order_email: string | null
  order_cc_emails: string[]
  account_number: string | null
  default_branch: string | null
  default_delivery_notes: string | null
  default_for_trades: string[]
  connection_type: 'email' | 'api'
}

export const SUPPLIER_FIELD_LABELS: Record<keyof SupplierInput, string> = {
  name: 'Name',
  active: 'Active',
  order_email: 'Order email',
  order_cc_emails: 'CC emails',
  account_number: 'Account number',
  default_branch: 'Branch',
  default_delivery_notes: 'Delivery notes',
  default_for_trades: 'Default for trades',
  connection_type: 'How orders are sent',
}

const clean = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.replace(/\s+/g, ' ').trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null

/** Validates untrusted JSON into a SupplierInput, or says what is wrong in plain English. */
export function parseSupplierInput(b: Record<string, unknown> | null): { ok: true; value: SupplierInput } | { ok: false; error: string } {
  if (!b) return { ok: false, error: 'Nothing to save' }
  const name = clean(b.name, 120)
  if (!name) return { ok: false, error: 'Name is required' }

  const rawEmail = typeof b.order_email === 'string' ? b.order_email.trim().toLowerCase() : ''
  if (rawEmail && !isStorableEmail(rawEmail)) {
    return { ok: false, error: 'Order email must be one valid address like orders@supplier.com (put extra addresses in CC)' }
  }

  const ccRaw = Array.isArray(b.order_cc_emails) ? b.order_cc_emails : typeof b.order_cc_emails === 'string' ? b.order_cc_emails.split(/[,;\n]/) : []
  const cc = Array.from(new Set(ccRaw.map((x) => String(x).trim().toLowerCase()).filter(Boolean)))
  const badCc = cc.find((e) => !isStorableEmail(e))
  if (badCc) return { ok: false, error: `CC address "${badCc.slice(0, 60)}" is not a valid email` }
  if (cc.length > 10) return { ok: false, error: 'At most 10 CC addresses' }

  const trades = Array.from(
    new Set((Array.isArray(b.default_for_trades) ? b.default_for_trades : []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))
  ).slice(0, 20)
  if (trades.some((t) => !/^[a-z0-9 _-]{1,40}$/.test(t))) return { ok: false, error: 'Trades use letters and numbers only' }

  const connection = b.connection_type === 'api' ? 'api' : 'email'
  return {
    ok: true,
    value: {
      name,
      active: b.active !== false,
      order_email: rawEmail || null,
      order_cc_emails: cc,
      account_number: clean(b.account_number, 100),
      default_branch: clean(b.default_branch, 200),
      default_delivery_notes: clean(b.default_delivery_notes, 1000),
      default_for_trades: trades,
      connection_type: connection,
    },
  }
}

export type FieldChange = { field: keyof SupplierInput; label: string; old: unknown; new: unknown }

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Every field that actually changed, old → new. `before` null = a new supplier. */
export function diffSupplier(before: Partial<SupplierInput> | null, after: SupplierInput): FieldChange[] {
  const out: FieldChange[] = []
  for (const key of Object.keys(SUPPLIER_FIELD_LABELS) as Array<keyof SupplierInput>) {
    const oldValue = before ? before[key] ?? (key === 'order_cc_emails' || key === 'default_for_trades' ? [] : null) : null
    if (!same(oldValue, after[key])) out.push({ field: key, label: SUPPLIER_FIELD_LABELS[key], old: oldValue, new: after[key] })
  }
  return out
}

/** One line for the change log screen. */
export function describeChange(c: FieldChange): string {
  const show = (v: unknown) => (Array.isArray(v) ? (v.length ? v.join(', ') : '(none)') : v === null || v === undefined || v === '' ? '(empty)' : String(v))
  return `${c.label}: ${show(c.old)} → ${show(c.new)}`
}
