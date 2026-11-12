/**
 * Pure builders: CRM facts + the company's mapping -> the exact bodies sent to QuickBooks. No I/O, so the money rules are
 * testable to the cent. Amounts are CRM integer cents; QuickBooks gets dollars via `dollars()`.
 *
 * Every money document carries our reference in PrivateNote (`[crm:<kind>:<id>]`) so a retry can FIND what an earlier,
 * unanswered attempt created. (A void keeps the record and prefixes "Voided" to PrivateNote, so the marker survives.)
 */
import { createHash } from 'crypto'

import type { CrmBill, CrmCustomer, CrmInvoice, CrmInvoiceLine, CrmJob, CrmPayment, CrmVendor } from './crm'
import { matchingQbCustomers } from './identity'
import type { QbSettings } from './mapping'

export type QbRefKind = 'inv' | 'pay' | 'ref' | 'bill' | 'cred'
export const crmMarker = (kind: QbRefKind, id: string) => `[crm:${kind}:${id}]`

export const dollars = (cents: number): number => Math.round(cents) / 100
export const centsOf = (dollarAmount: unknown): number => Math.round((Number(dollarAmount) || 0) * 100)

export function sha(text: string, len = 32): string {
  return createHash('sha256').update(text).digest('hex').slice(0, len)
}

/** Stable JSON (sorted keys) so the same facts always hash the same. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}
export const fingerprintOf = (facts: unknown): string => sha(canonical(facts), 40)

/**
 * Intuit `requestid`: <= 50 characters, unique per company, a repeated id returns the FIRST response instead of running again.
 * 32 hex chars of a hash of (what, step, the facts being sent) — a changed payload gets a new id, a retried one reuses it.
 */
export function requestIdFor(orgId: string, what: string, facts: unknown): string {
  return sha(`${orgId}|${what}|${canonical(facts)}`, 32)
}

export class BuildError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

const clip = (v: string, n: number) => (v.length > n ? v.slice(0, n) : v)

// ---------- customers ----------
export const firstAddressLine = (a: string | null) => a?.split(',')[0]?.trim() || null
const digits = (v: string | null) => (v ?? '').replace(/\D/g, '').slice(-10)

/** The names to try, in order: the CRM name, then name + street, then name + "(Customer)". */
export function customerNameCandidates(c: Pick<CrmCustomer, 'name' | 'addressText' | 'id'>): string[] {
  const base = clip(c.name.replace(/[:\t\n\r]/g, ' ').trim(), 100) || 'Customer'
  const street = firstAddressLine(c.addressText)
  return Array.from(new Set([base, street ? clip(`${base} - ${street}`, 100) : `${base} (${c.id.slice(0, 4)})`, clip(`${base} (Customer)`, 100)]))
}

export function buildCustomerBody(c: CrmCustomer, displayName: string): Record<string, unknown> {
  return {
    DisplayName: displayName,
    ...(c.email ? { PrimaryEmailAddr: { Address: clip(c.email, 100) } } : {}),
    ...(c.phone ? { PrimaryPhone: { FreeFormNumber: clip(c.phone, 21) } } : {}),
    ...(c.addressText ? { BillAddr: { Line1: clip(c.addressText, 500) } } : {}),
    ...(c.taxExempt ? { Taxable: false } : {}),
  }
}

/** Does a QuickBooks customer look like the same person as ours? The CRM's one matching rule (lib/quickbooks/identity.ts). */
export function samePerson(ours: { name?: string | null; email: string | null; phone: string | null; addressText?: string | null }, qb: Record<string, any>): boolean {
  return matchingQbCustomers(ours, [qb]).length > 0
}

export function subCustomerName(job: Pick<CrmJob, 'jobNumber' | 'addressText'>): string {
  const street = firstAddressLine(job.addressText)
  return clip(street ? `${job.jobNumber} ${street}` : job.jobNumber, 100).replace(/[:\t\n\r]/g, ' ')
}

export function buildSubCustomerBody(job: CrmJob, parentQbId: string): Record<string, unknown> {
  return {
    DisplayName: subCustomerName(job),
    Job: true,
    ParentRef: { value: parentQbId },
    BillWithParent: false,
    ...(job.addressText ? { BillAddr: { Line1: clip(job.addressText, 500) } } : {}),
  }
}

// ---------- invoices ----------
export type InvoiceBuildContext = {
  settings: QbSettings
  customerRef: string
  /** CRM sales-tax rate id -> display, only used to name nothing; the QuickBooks ids come from settings.tax.rateMap. */
}

function itemFor(line: CrmInvoiceLine, s: QbSettings): string {
  const item = (line.tradeSlug && s.income.byTrade[line.tradeSlug]) || s.income.defaultItemId
  if (!item) throw new BuildError('mapping', 'No QuickBooks item is chosen for sales.')
  return item
}

/** Cents the lines add up to. */
export const linesCents = (lines: ReadonlyArray<{ amountCents: number }>) => lines.reduce((t, l) => t + l.amountCents, 0)

/**
 * The money invariant, checked BEFORE anything is sent: lines + tax = the CRM total, to the cent. A document that does not add up
 * is never sent (it is a Needs-you line), so QuickBooks can only ever receive a total the CRM stands behind.
 */
export function assertInvoiceAddsUp(inv: Pick<CrmInvoice, 'lines' | 'taxCents' | 'taxLines' | 'totalCents' | 'docNumber'>): void {
  if (linesCents(inv.lines) + inv.taxCents !== inv.totalCents) {
    throw new BuildError('money_mismatch', `Invoice ${inv.docNumber}: the lines ($${dollars(linesCents(inv.lines)).toFixed(2)}) plus sales tax ($${dollars(inv.taxCents).toFixed(2)}) do not equal the total ($${dollars(inv.totalCents).toFixed(2)}).`)
  }
  if (inv.taxLines.length > 0 && inv.taxLines.reduce((t, l) => t + l.amount_cents, 0) !== inv.taxCents) {
    throw new BuildError('money_mismatch', `Invoice ${inv.docNumber}: the sales tax lines do not add up to the sales tax.`)
  }
}

export function buildInvoiceBody(inv: CrmInvoice, ctx: InvoiceBuildContext): Record<string, unknown> {
  const s = ctx.settings
  assertInvoiceAddsUp(inv)
  if (inv.lines.length === 0) throw new BuildError('empty', `Invoice ${inv.docNumber} has no lines.`)
  const taxed = s.tax.mode !== 'none'
  if (!taxed && inv.taxCents > 0) throw new BuildError('tax_not_set_up', `Invoice ${inv.docNumber} has $${dollars(inv.taxCents).toFixed(2)} sales tax, but sales tax is not set up in the QuickBooks mapping.`)
  const Line = inv.lines.map((l) => {
    const exact = l.qty != null && l.unitPriceCents != null && l.qty > 0 && Math.abs(l.qty * l.unitPriceCents - l.amountCents) < 0.5
    return {
      Amount: dollars(l.amountCents),
      Description: clip(l.description, 4000),
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: { value: itemFor(l, s) },
        Qty: exact ? l.qty : 1,
        UnitPrice: exact ? dollars(l.unitPriceCents as number) : dollars(l.amountCents),
        ...(taxed ? { TaxCodeRef: { value: l.taxable ? 'TAX' : 'NON' } } : {}),
      },
    }
  })
  let tax: Record<string, unknown> = {}
  if (s.tax.mode === 'code' && inv.taxCents > 0) {
    if (!s.tax.taxCodeId) throw new BuildError('mapping', 'No QuickBooks sales tax code is chosen.')
    const rows = inv.taxLines.length ? inv.taxLines : null
    // Lines with no stored split (older proposals) are sent as one lump on the chosen code's first mapped rate.
    const first = Object.values(s.tax.rateMap)[0]
    const TaxLine = (rows ?? [{ id: null, name: 'Sales tax', percent: 0, amount_cents: inv.taxCents }]).map((t) => {
      const rate = (t.id && s.tax.rateMap[t.id]) || (!rows ? first : null)
      if (!rate) throw new BuildError('mapping', `Sales tax “${t.name}” has no matching rate in the QuickBooks tax code.`)
      const taxableNet = inv.lines.filter((l) => l.taxable).reduce((x, l) => x + l.amountCents, 0)
      return { Amount: dollars(t.amount_cents), DetailType: 'TaxLineDetail', TaxLineDetail: { TaxRateRef: { value: rate }, PercentBased: true, ...(t.percent > 0 ? { TaxPercent: t.percent } : {}), NetAmountTaxable: dollars(taxableNet) } }
    })
    tax = { TxnTaxDetail: { TxnTaxCodeRef: { value: s.tax.taxCodeId }, TotalTax: dollars(inv.taxCents), TaxLine } }
  }
  return {
    DocNumber: clip(inv.docNumber, 21),
    ...(inv.txnDate ? { TxnDate: inv.txnDate } : {}),
    ...(inv.dueDate ? { DueDate: inv.dueDate } : {}),
    CustomerRef: { value: ctx.customerRef },
    ...(s.receivablesAccountId ? { ARAccountRef: { value: s.receivablesAccountId } } : {}),
    PrivateNote: crmMarker('inv', inv.source.id),
    ...(inv.memo ? { CustomerMemo: { value: clip(inv.memo, 1000) } } : {}),
    Line,
    ...tax,
  }
}

/** What we stand behind for an invoice — the fingerprint: change any of this and the invoice is sent again. */
export function invoiceFacts(inv: CrmInvoice, customerRef: string, s: QbSettings) {
  return { d: inv.docNumber, t: inv.txnDate, due: inv.dueDate, c: customerRef, l: inv.lines, x: inv.taxLines, tc: inv.taxCents, tot: inv.totalCents, m: inv.memo, tm: s.tax.mode, tx: s.tax.taxCodeId, it: s.income, ar: s.receivablesAccountId }
}

// ---------- payments ----------
export type PaymentApplication = { invoiceQbId: string; cents: number }

export function buildPaymentBody(p: Pick<CrmPayment, 'id' | 'paidAt' | 'amountCents' | 'method' | 'note'>, ctx: { settings: QbSettings; customerRef: string; applications: PaymentApplication[] }): Record<string, unknown> {
  const applied = ctx.applications.reduce((t, a) => t + a.cents, 0)
  if (!(p.amountCents > 0)) throw new BuildError('money_mismatch', 'A payment must be more than $0.')
  if (applied > p.amountCents) throw new BuildError('money_mismatch', 'The payment is applied to more than it was.')
  if (!ctx.settings.depositToAccountId) throw new BuildError('mapping', 'No QuickBooks deposit account is chosen.')
  return {
    CustomerRef: { value: ctx.customerRef },
    TotalAmt: dollars(p.amountCents),
    ...(p.paidAt ? { TxnDate: p.paidAt } : {}),
    DepositToAccountRef: { value: ctx.settings.depositToAccountId },
    PrivateNote: clip(`${crmMarker('pay', p.id)}${p.method ? ` ${p.method}` : ''}${p.note ? ` — ${p.note}` : ''}`, 4000),
    ...(ctx.applications.length > 0 ? { Line: ctx.applications.map((a) => ({ Amount: dollars(a.cents), LinkedTxn: [{ TxnId: a.invoiceQbId, TxnType: 'Invoice' }] })) } : {}),
  }
}

/** Money that went back to the customer. Posted as a Refund Receipt for the gross amount (tax is not split out: bookkeeper decision). */
export function buildRefundReceiptBody(p: Pick<CrmPayment, 'id' | 'paidAt' | 'amountCents' | 'method' | 'note'>, ctx: { settings: QbSettings; customerRef: string; disputed: boolean }): Record<string, unknown> {
  const refundCents = Math.abs(p.amountCents)
  const s = ctx.settings
  if (!s.depositToAccountId) throw new BuildError('mapping', 'No QuickBooks account is chosen for money going back to customers.')
  if (!s.income.defaultItemId) throw new BuildError('mapping', 'No QuickBooks item is chosen for sales.')
  return {
    CustomerRef: { value: ctx.customerRef },
    ...(p.paidAt ? { TxnDate: p.paidAt } : {}),
    DepositToAccountRef: { value: s.depositToAccountId },
    PrivateNote: clip(`${crmMarker('ref', p.id)} ${ctx.disputed ? 'Lost dispute' : 'Refund'}${p.method ? ` (${p.method})` : ''}${p.note ? ` — ${p.note}` : ''}`, 4000),
    Line: [
      {
        Amount: dollars(refundCents),
        Description: ctx.disputed ? 'Lost card dispute' : 'Refund to customer',
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: { ItemRef: { value: s.income.defaultItemId }, Qty: 1, UnitPrice: dollars(refundCents), ...(s.tax.mode !== 'none' ? { TaxCodeRef: { value: 'NON' } } : {}) },
      },
    ],
  }
}

// ---------- vendors + bills ----------
export function vendorNameCandidates(v: Pick<CrmVendor, 'name'>): string[] {
  const base = clip(v.name.replace(/[:\t\n\r]/g, ' ').trim(), 100) || 'Vendor'
  return Array.from(new Set([base, clip(`${base} (Vendor)`, 100)]))
}

export function buildVendorBody(v: CrmVendor, displayName: string, is1099: boolean): Record<string, unknown> {
  return {
    DisplayName: displayName,
    ...(v.email ? { PrimaryEmailAddr: { Address: clip(v.email, 100) } } : {}),
    ...(v.phone ? { PrimaryPhone: { FreeFormNumber: clip(v.phone, 21) } } : {}),
    Vendor1099: is1099,
  }
}

export function buildBillBody(b: CrmBill, ctx: { settings: QbSettings; vendorRef: string; jobCustomerRef: string | null }): { entity: 'Bill' | 'VendorCredit'; body: Record<string, unknown> } {
  const s = ctx.settings
  if (!s.bills.expenseAccountId) throw new BuildError('mapping', 'No QuickBooks expense account is chosen for vendor bills.')
  if (!(b.amountCents > 0)) throw new BuildError('money_mismatch', 'A bill must be more than $0.')
  const entity = b.isCredit ? 'VendorCredit' : 'Bill'
  const description = clip([b.poNumber ? `PO ${b.poNumber}` : null, b.costType, b.notes].filter(Boolean).join(' — ') || 'Vendor bill', 4000)
  return {
    entity,
    body: {
      VendorRef: { value: ctx.vendorRef },
      TxnDate: b.billDate,
      // QuickBooks' DocNumber is at most 21 characters; a longer vendor number goes in the memo instead of being cut.
      ...(b.billNumber && b.billNumber.length <= 21 ? { DocNumber: b.billNumber } : {}),
      PrivateNote: clip(`${crmMarker(b.isCredit ? 'cred' : 'bill', b.id)}${b.billNumber && b.billNumber.length > 21 ? ` vendor no. ${b.billNumber}` : ''}`, 4000),
      Line: [
        {
          Amount: dollars(b.amountCents),
          Description: description,
          DetailType: 'AccountBasedExpenseLineDetail',
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: s.bills.expenseAccountId },
            ...(ctx.jobCustomerRef ? { CustomerRef: { value: ctx.jobCustomerRef }, BillableStatus: 'NotBillable' } : {}),
            ...(s.bills.classId ? { ClassRef: { value: s.bills.classId } } : {}),
          },
        },
      ],
    },
  }
}

/** Cents of a QuickBooks money field. */
export const qbCents = (v: unknown): number => centsOf(v)
