import { PrintButton } from '@/components/portal/PortalActions'
import { money, shortDate } from '@/components/portal/format'
import { Panel } from '@/components/portal/PortalShell'
import { batchLineWhere, rollLabel, type BatchDocument } from '@/lib/invoice-batch'

/** The master invoice as the customer reads it (portal + the mobile harness): every house, one total. Never notes or costs. */
export default function PortalBatchBody({ doc }: { doc: BatchDocument }) {
  const showCommunity = !doc.development
  return (
    <Panel>
      <h1 className="text-2xl font-bold">Invoice {doc.batch.number}</h1>
      <p className="mt-1 text-base">{doc.billTo.name}{doc.development ? ` · ${doc.development}` : ''}{doc.dueAt ? ` · due ${shortDate(doc.dueAt)}` : ''}</p>
      <ul className="mt-4 divide-y divide-[#e5e3dc]">
        {doc.lines.map((l) => (
          <li key={l.invoiceId} className="flex justify-between gap-3 py-2 text-base">
            <span className="min-w-0 break-words">
              <span className="block font-semibold">{batchLineWhere(l, showCommunity) || `Job ${l.jobNumber}`}</span>
              <span className="block">Job {l.jobNumber}{l.customerPo ? ` · PO ${l.customerPo}` : ''}{rollLabel(l.rollCount) ? ` · ${rollLabel(l.rollCount)}` : ''}</span>
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
  )
}
