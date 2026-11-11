import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { PayButton, PrintButton } from '@/components/portal/PortalActions'
import { money, shortDate } from '@/components/portal/format'
import PortalShell, { Panel } from '@/components/portal/PortalShell'
import { loadInvoiceDocument } from '@/lib/invoice-document'
import { loadOnlinePayments } from '@/lib/online-payments/accounts'
import { loadPortalCompany } from '@/lib/portal/brand'
import { findPortalInvoice } from '@/lib/portal/data'
import { getPortalSession } from '@/lib/portal/server'
import { orgDb } from '@/lib/supabase/org-db'
import { createServiceClient } from '@/lib/supabase/service'
import type { JobInvoice } from '@/lib/types/invoices'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Invoice', robots: { index: false, follow: false }, referrer: 'no-referrer' }

/** One invoice of the signed-in customer: lines, tax, what is paid, Pay, and print / save as PDF. Never notes or costs. */
export default async function PortalInvoicePage({ params }: { params: { id: string } }) {
  const admin = createServiceClient()
  const session = await getPortalSession(admin)
  if (!session) notFound()
  const found = await findPortalInvoice(admin, session, params.id)
  if (!found) notFound()
  const { data } = await orgDb(admin, session.orgId).from('job_invoices').select('*').eq('id', found.id).maybeSingle()
  if (!data) notFound()
  const doc = await loadInvoiceDocument(admin, session.orgId, data as JobInvoice)
  const company = await loadPortalCompany(admin, session.orgId)
  const op = await loadOnlinePayments(admin, session.orgId)
  const inv = doc.invoice
  return (
    <PortalShell company={company} wide signOut>
      <a href="/portal" className="mb-3 inline-flex min-h-[44px] items-center text-base font-bold underline print:hidden">← Back to my account</a>
      <Panel>
        <h1 className="text-2xl font-bold">Invoice {inv.invoice_number}</h1>
        <p className="mt-1 text-base">{inv.issued_at ? `Issued ${shortDate(inv.issued_at)}` : ''}{inv.due_at ? ` · due ${shortDate(inv.due_at)}` : ''}</p>
        <p className="mt-1 text-base">{doc.billTo.name}{doc.billTo.address ? ` · ${doc.billTo.address}` : ''}</p>
        <ul className="mt-4 divide-y divide-[#e5e3dc]">
          {doc.items.map((it) => (
            <li key={it.id} className="flex justify-between gap-3 py-2 text-base">
              <span className="min-w-0 break-words">{it.description}</span>
              <span className="font-semibold tabular-nums">{money(it.line_total_cents)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1 border-t border-[#e5e3dc] pt-3 text-base">
          {doc.taxRows.map((t) => (
            <div key={t.label} className="flex justify-between"><dt>{t.label}</dt><dd className="tabular-nums">{money(t.amountCents)}</dd></div>
          ))}
          <div className="flex justify-between text-lg font-bold"><dt>Total</dt><dd className="tabular-nums">{money(inv.total_cents)}</dd></div>
          <div className="flex justify-between"><dt>Paid</dt><dd className="tabular-nums">{money(doc.appliedCents)}</dd></div>
          <div className="flex justify-between text-lg font-bold"><dt>{doc.isPaid ? 'Balance' : 'Left to pay'}</dt><dd className="tabular-nums">{money(Math.max(0, doc.balanceCents))}</dd></div>
        </dl>
        {inv.public_note ? <p className="mt-3 whitespace-pre-wrap text-base">{inv.public_note}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {!doc.isPaid && op.featureOn && op.ready ? <PayButton invoiceId={found.id} label={`Pay ${money(Math.max(0, doc.balanceCents))}`} /> : null}
          <PrintButton />
        </div>
      </Panel>
    </PortalShell>
  )
}
