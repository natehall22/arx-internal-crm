/**
 * "Is this QuickBooks customer the same person as this CRM customer?" — answered by the ONE CRM matching rule
 * (`matchExistingCustomer`, lib/customers.ts: real email, then 10-digit phone, then exact name + address). The QuickBooks record is
 * only reshaped into the CRM's identity row; there is no second rule. Used by the worker (adopt on first send) and the backfill.
 */
import { matchExistingCustomer, normalizeIdentityEmail, type CustomerIdentityRow } from '@/lib/customers'

type QbRecord = Record<string, any>

const tenDigits = (v: unknown): string | null => {
  const d = String(v ?? '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : null
}

export function qbAddressText(qb: QbRecord): string | null {
  const a = qb.BillAddr ?? qb.ShipAddr
  if (!a) return null
  const tail = [a.CountrySubDivisionCode, a.PostalCode].filter(Boolean).join(' ')
  return [a.Line1, a.City, tail].filter((x) => typeof x === 'string' && x.trim()).join(', ') || null
}

export function qbIdentityRow(qb: QbRecord): CustomerIdentityRow {
  return {
    id: String(qb.Id),
    name: String(qb.DisplayName ?? qb.FullyQualifiedName ?? ''),
    email_lower: normalizeIdentityEmail(qb.PrimaryEmailAddr?.Address ?? null),
    phone_normalized: tenDigits(qb.PrimaryPhone?.FreeFormNumber) ?? tenDigits(qb.Mobile?.FreeFormNumber),
    address_text: qbAddressText(qb),
    created_at: String(qb.MetaData?.CreateTime ?? '1970-01-01T00:00:00Z'),
  }
}

export type OurIdentity = { name?: string | null; email: string | null; phone: string | null; addressText?: string | null }

/** The QuickBooks customers that match this person under the CRM rule, best match first (each step's oldest). */
export function matchingQbCustomers<T extends QbRecord>(ours: OurIdentity, qbRecords: T[]): T[] {
  const byId = new Map(qbRecords.map((r) => [String(r.Id), r]))
  let rows = qbRecords.map(qbIdentityRow)
  const out: T[] = []
  for (;;) {
    const hit = matchExistingCustomer(rows, { name: ours.name ?? '', email: ours.email, phone: ours.phone, address_text: ours.addressText ?? null })
    if (!hit) return out
    out.push(byId.get(hit.id) as T)
    rows = rows.filter((r) => r.id !== hit.id)
  }
}
