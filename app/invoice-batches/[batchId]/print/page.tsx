import { redirect } from 'next/navigation'

import PrintButton from '@/app/invoices/[invoiceId]/print/PrintButton'
import { requireAuth } from '@/lib/auth'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { batchLineWhere } from '@/lib/invoice-batch'
import { findBatch, loadBatchDocument } from '@/lib/invoice-batch-db'
import { formatCurrency, formatInvoiceDisplayDate } from '@/lib/job-payments'
import { requireOrgFeaturePage } from '@/lib/org-features-server'
import { createServiceClient } from '@/lib/supabase/service'

/** The master invoice as one printable page: a block per house (job, lot / address, PO, amount) and one total. Same gate as the invoice print. */
export default async function PrintBatchPage({ params }: { params: { batchId: string } }) {
  const { profile } = await requireAuth()
  await requireOrgFeaturePage(profile.org_id, 'masterInvoices')
  const admin = createServiceClient()
  if (!(await callerCanAccessJobBilling(admin, profile))) redirect('/dashboard')
  const batch = await findBatch(admin, profile.org_id, params.batchId)
  const doc = batch ? await loadBatchDocument(admin, profile.org_id, batch) : null
  if (!doc) return <div className="p-8 text-center">Invoice not found</div>
  const showCommunity = !doc.development
  const th = { background: '#1a365d', color: '#fff', padding: 12, textAlign: 'left' as const, fontSize: 12 }
  const td = { padding: 12, borderBottom: '1px solid #e2e8f0', fontSize: 13, color: '#1a202c' }
  return (
    <html>
      <head>
        <title>Invoice {doc.batch.number}</title>
        <style>{`@media print { .no-print { display: none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } } body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a202c; margin: 0; } .page { max-width: 800px; margin: 0 auto; padding: 40px; }`}</style>
      </head>
      <body>
        <PrintButton />
        <div className="page">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 32 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#1a365d' }}>{doc.company.legalName}</div>
              <div style={{ fontSize: 12, whiteSpace: 'pre-line' }}>{[doc.company.address, doc.company.phone, doc.company.email].filter(Boolean).join('\n')}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 32, fontWeight: 700, color: '#1a365d' }}>INVOICE</div>
              <div style={{ fontSize: 12 }}>Invoice #: <b>{doc.batch.number}</b></div>
              <div style={{ fontSize: 12 }}>Date: <b>{formatInvoiceDisplayDate(doc.batch.sentAt ?? doc.batch.createdAt)}</b></div>
              {doc.dueAt ? <div style={{ fontSize: 12 }}>Due Date: <b>{formatInvoiceDisplayDate(doc.dueAt)}</b></div> : null}
            </div>
          </div>
          <div style={{ background: '#f7fafc', padding: 16, borderRadius: 8, marginBottom: 24 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Bill To</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{doc.billTo.name}</div>
            {doc.development ? <div style={{ fontSize: 13 }}>{doc.development}</div> : null}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
            <thead>
              <tr>
                <th style={th}>Job</th>
                <th style={th}>{showCommunity ? 'Development · Lot · Address' : 'Lot · Address'}</th>
                <th style={th}>PO #</th>
                <th style={{ ...th, textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l) => (
                <tr key={l.invoiceId}>
                  <td style={td}>{l.jobNumber}</td>
                  <td style={td}>{batchLineWhere(l, showCommunity)}</td>
                  <td style={td}>{l.customerPo ?? ''}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{formatCurrency(l.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginLeft: 'auto', width: 300, fontSize: 14 }}>
            {doc.taxCents > 0 ? <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px' }}><span>Includes sales tax</span><span>{formatCurrency(doc.taxCents)}</span></div> : null}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', background: '#1a365d', color: '#fff', fontWeight: 700 }}><span>Total</span><span>{formatCurrency(doc.totalCents)}</span></div>
            {doc.paidCents > 0 ? <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px' }}><span>Payments Applied</span><span>({formatCurrency(doc.paidCents)})</span></div> : null}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', fontWeight: 700, background: doc.balanceCents <= 0 ? '#2f855a' : '#c53030', color: '#fff' }}><span>Balance Due</span><span>{doc.balanceCents <= 0 ? 'PAID' : formatCurrency(doc.balanceCents)}</span></div>
          </div>
          {doc.batch.publicNote ? <p style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{doc.batch.publicNote}</p> : null}
          <div style={{ textAlign: 'center', marginTop: 40, fontSize: 11, color: '#4a5568' }}>{doc.company.legalName} • {doc.batch.number}</div>
        </div>
      </body>
    </html>
  )
}
