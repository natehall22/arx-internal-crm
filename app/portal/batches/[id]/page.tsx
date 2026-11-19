import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { PrintButton } from '@/components/portal/PortalActions'
import { money, shortDate } from '@/components/portal/format'
import PortalShell, { Panel } from '@/components/portal/PortalShell'
import { batchLineWhere } from '@/lib/invoice-batch'
import { findBatch, loadBatchDocument } from '@/lib/invoice-batch-db'
import { loadPortalCompany } from '@/lib/portal/brand'
import { getPortalSession } from '@/lib/portal/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Invoice', robots: { index: false, follow: false }, referrer: 'no-referrer' }

/**
 * A SENT master invoice of the signed-in customer: every house, one total, print / save. Only for the customer it was made for
 * (batch.customer_id), and only once it has been sent. Never notes or costs. (Online payment stays on each house's own invoice.)
 */
export default async function PortalBatchPage({ params }: { params: { id: string } }) {
  const admin = createServiceClient()
  const session = await getPortalSession(admin)
  if (!session) notFound()
  const batch = await findBatch(admin, session.orgId, params.id)
  if (!batch || batch.customer_id !== session.customerId || !batch.sent_at) notFound()
  const doc = await loadBatchDocument(admin, session.orgId, batch)
  if (!doc) notFound()
  const company = await loadPortalCompany(admin, session.orgId)
  const showCommunity = !doc.development
  return (
    <PortalShell company={company} wide signOut>
      <a href="/portal" className="mb-3 inline-flex min-h-[44px] items-center text-base font-bold underline print:hidden">← Back to my account</a>
      <Panel>
        <h1 className="text-2xl font-bold">Invoice {doc.batch.number}</h1>
        <p className="mt-1 text-base">{doc.billTo.name}{doc.development ? ` · ${doc.development}` : ''}{doc.dueAt ? ` · due ${shortDate(doc.dueAt)}` : ''}</p>
        <ul className="mt-4 divide-y divide-[#e5e3dc]">
          {doc.lines.map((l) => (
            <li key={l.invoiceId} className="flex justify-between gap-3 py-2 text-base">
              <span className="min-w-0 break-words">
                <span className="block font-semibold">{batchLineWhere(l, showCommunity) || `Job ${l.jobNumber}`}</span>
                <span className="block">Job {l.jobNumber}{l.customerPo ? ` · PO ${l.customerPo}` : ''}{l.rollCount != null ? ` · ${l.rollCount} rolls` : ''}</span>
              </span>
              <span className="font-semibold tabular-nums">{money(l.amountCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1 border-t border-[#e5e3dc] pt-3 text-base">
          <div className="flex justify-between text-lg font-bold"><dt>Total</dt><dd className="tabular-nums">{money(doc.totalCents)}</dd></div>
          <div className="flex justify-between"><dt>Paid</dt><dd className="tabular-nums">{money(doc.paidCents)}</dd></div>
          <div className="flex justify-between text-lg font-bold"><dt>{doc.balanceCents <= 0 ? 'Balance' : 'Left to pay'}</dt><dd className="tabular-nums">{money(Math.max(0, doc.balanceCents))}</dd></div>
        </dl>
        {doc.batch.publicNote ? <p className="mt-3 whitespace-pre-wrap text-base">{doc.batch.publicNote}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2"><PrintButton /></div>
      </Panel>
    </PortalShell>
  )
}
