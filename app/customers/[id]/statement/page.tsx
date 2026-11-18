export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'

import PrintButton from '@/app/invoices/[invoiceId]/print/PrintButton'
import { requireAuth } from '@/lib/auth'
import { loadCustomerStatement } from '@/lib/customer-statement'
import { canBillService } from '@/lib/service-billing-access'
import { companyIdentity } from '@/lib/customer-messages-db'
import { invoiceItemDateLabel } from '@/lib/invoice-lines'
import { formatCurrency } from '@/lib/job-payments'
import { methodLabel } from '@/lib/payment-receipt'
import { createServiceClient } from '@/lib/supabase/service'

/** Printable customer statement (open invoices + payments in the last 90 days). Billing staff only, company-scoped; every number is the same one the invoice list shows. */
export default async function CustomerStatementPage({ params }: { params: { id: string } }) {
  const { profile } = await requireAuth()
  const admin = createServiceClient()
  if (!(await canBillService(admin, profile)).bill) redirect('/dashboard')
  const statement = await loadCustomerStatement(admin, profile.org_id, params.id)
  if (!statement) return <div className="p-8 text-center text-ink">Customer not found</div>
  const { data: org } = await admin.from('orgs').select('id, name, address, phone, email, settings').eq('id', profile.org_id).maybeSingle()
  const company = org ? companyIdentity(org as Parameters<typeof companyIdentity>[0], null).company : null
  const th = 'border-b-2 border-black px-2 py-2 text-left text-sm font-bold text-black'
  const td = 'border-b border-gray-300 px-2 py-2 text-sm text-black'
  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-black">
      <style>{'@media print{.no-print{display:none !important}}'}</style>
      <PrintButton />
      <h1 className="text-2xl font-bold">{company?.name ?? ''}</h1>
      {company?.addressLine ? <div className="text-sm">{company.addressLine}</div> : null}
      {company ? <div className="text-sm">{[company.phone, company.email].filter(Boolean).join(' · ')}</div> : null}
      <h2 className="mt-6 text-xl font-bold">Statement</h2>
      <div className="text-sm">{statement.customer.name}{statement.customer.address ? ` · ${statement.customer.address}` : ''}</div>
      <div className="mb-4 text-sm">As of {invoiceItemDateLabel(statement.asOf)}</div>
      <div className="mb-4 rounded border border-black p-3 text-base font-bold">
        {statement.owedCents > 0 ? `Total owed ${formatCurrency(statement.owedCents)}${statement.overdueCents > 0 ? ` · ${formatCurrency(statement.overdueCents)} past due` : ''}` : 'Paid up — nothing owed'}
      </div>
      {statement.open.length > 0 ? (
        <table className="mb-6 w-full border-collapse">
          <thead><tr><th className={th}>Invoice</th><th className={th}>Issued</th><th className={th}>Due</th><th className={`${th} text-right`}>Total</th><th className={`${th} text-right`}>Owed</th></tr></thead>
          <tbody>
            {statement.open.map((r) => (
              <tr key={r.id}>
                <td className={td}>{r.invoiceNumber}{r.daysOverdue > 0 ? ` (${r.daysOverdue} days late)` : ''}</td>
                <td className={td}>{r.issuedAt ? invoiceItemDateLabel(r.issuedAt) : ''}</td>
                <td className={td}>{r.dueAt ? invoiceItemDateLabel(r.dueAt) : ''}</td>
                <td className={`${td} text-right`}>{formatCurrency(r.totalCents)}</td>
                <td className={`${td} text-right font-bold`}>{formatCurrency(r.balanceCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <h3 className="mb-2 text-base font-bold">Payments received, last 90 days</h3>
      {statement.payments.length > 0 ? (
        <table className="w-full border-collapse">
          <thead><tr><th className={th}>Date</th><th className={th}>Invoice</th><th className={th}>Paid by</th><th className={`${th} text-right`}>Amount</th></tr></thead>
          <tbody>
            {statement.payments.map((p, i) => (
              <tr key={`${p.invoiceNumber}-${p.paidAt}-${i}`}><td className={td}>{invoiceItemDateLabel(p.paidAt)}</td><td className={td}>{p.invoiceNumber}</td><td className={td}>{methodLabel(p.method)}</td><td className={`${td} text-right`}>{formatCurrency(p.amountCents)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm">No payments in the last 90 days.</p>
      )}
    </div>
  )
}
