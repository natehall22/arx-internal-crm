/**
 * Supplier records (the `vendors` table as the ordering flow uses it): who may edit them, how an edit is
 * validated, and how a change is described for the change log. One module for the API, the page and tests.
 */
import { isOwnerProfile } from '@/lib/super-admin'
/** ASCII-only, one address, max 254 chars. Stricter than the mailer's check on purpose: this is what we STORE. */
const STORED_EMAIL_RE = /^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/
export const isStorableEmail = (v: string): boolean => v.length <= 254 && STORED_EMAIL_RE.test(v)

/** Owners only: a super admin, or the `owner` role. Supplier emails decide where job addresses are sent. */
export const canManageSuppliers = isOwnerProfile

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
  /** Vendor directory (migration 202611120050). Left out of the save when the form did not send them — the stored value stays. */
  vendor_type?: 'supplier' | 'sub' | 'both'
  phone?: string | null
  contact_name?: string | null
  trades?: string[]
  /** Only when creating a vendor from an existing subcontractor. */
  sub_contractor_id?: string | null
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
  vendor_type: 'Type',
  phone: 'Phone',
  contact_name: 'Contact',
  trades: 'Trades',
  sub_contractor_id: 'Subcontractor',
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

  const extra: Partial<SupplierInput> = {}
  if (b.vendor_type !== undefined) {
    if (b.vendor_type !== 'supplier' && b.vendor_type !== 'sub' && b.vendor_type !== 'both') return { ok: false, error: 'Pick supplier, subcontractor or both.' }
    extra.vendor_type = b.vendor_type
  }
  if ('phone' in b) extra.phone = clean(b.phone, 40)
  if ('contact_name' in b) extra.contact_name = clean(b.contact_name, 120)
  if (Array.isArray(b.trades)) {
    const vt = Array.from(new Set(b.trades.map((t) => String(t).trim().toLowerCase()).filter(Boolean))).slice(0, 20)
    if (vt.some((t) => !/^[a-z0-9 _-]{1,40}$/.test(t))) return { ok: false, error: 'Trades use letters and numbers only' }
    extra.trades = vt
  }
  if (typeof b.sub_contractor_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.sub_contractor_id)) extra.sub_contractor_id = b.sub_contractor_id
  return {
    ok: true,
    value: {
      ...extra,
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

/** One entry of the change log (written by the database function save_supplier) — the shared shape, lib/change-log.ts. */
export { describeChange, type FieldChange } from '@/lib/change-log'
