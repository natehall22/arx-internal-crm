import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { formatCurrency, formatInvoiceDisplayDate } from '@/lib/job-payments'
import { redirect } from 'next/navigation'
import PrintButton from './PrintButton'
import { formatPhone } from '@/lib/format'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { findPrintableInvoice, loadInvoiceDocument } from '@/lib/invoice-document'
import { invoiceItemDateLabel, invoiceItemPriceLabel, invoiceItemQtyLabel } from '@/lib/invoice-lines'

export default async function PrintInvoicePage({
  params,
}: {
  params: { invoiceId: string }
}) {
  // requireAuth redirects to /login and enforces the DEPLOYMENT_ORG_ID fence (the old raw Supabase user lookup skipped it).
  const { profile } = await requireAuth()
  const adminClient = createServiceClient()
  // Printing an invoice is part of the job's books: money:record (it had no check at all before).
  if (!(await callerCanAccessJobBilling(adminClient, profile))) {
    redirect('/dashboard')
  }

  // By id, else by invoice_number — both scoped to the caller's company (lib/invoice-document.ts findPrintableInvoice):
  // job invoices through their job, invoices without a job (recurring service) through their own org.
  const found = await findPrintableInvoice(adminClient, profile.org_id, params.invoiceId)
  if (!found) {
    return <div className="p-8 text-center">Invoice not found</div>
  }

  // THE invoice model, shared with the customer email (lib/invoice-email.ts).
  const doc = await loadInvoiceDocument(adminClient, profile.org_id, found)
  const invoice = doc.invoice
  const items = doc.items
  const appliedCents = doc.appliedCents
  const legalName = doc.company.legalName
  const resolvedCustomer = doc.billTo
  const balanceCents = doc.balanceCents
  const isPaid = doc.isPaid
  const companyContact = doc.company

  return (
    <html>
      <head>
        <title>Invoice {invoice.invoice_number}</title>
        <style>{`
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .no-print { display: none !important; }
          }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; margin: 0; padding: 0; }
          .page { max-width: 800px; margin: 0 auto; padding: 40px; }
          .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
          .company-name { font-size: 24px; font-weight: bold; color: #1a365d; margin-bottom: 8px; }
          .company-address { font-size: 12px; color: #666; white-space: pre-line; }
          .invoice-title { font-size: 32px; font-weight: bold; color: #1a365d; text-align: right; margin-bottom: 12px; }
          .invoice-meta { font-size: 12px; text-align: right; margin-bottom: 4px; }
          .invoice-meta-label { color: #666; }
          .invoice-meta-value { font-weight: bold; }
          .bill-to { background: #f7fafc; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
          .bill-to-label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
          .bill-to-name { font-size: 16px; font-weight: bold; margin-bottom: 4px; }
          .bill-to-address { font-size: 13px; color: #444; white-space: pre-line; }
          .warning-banner { background: #fef3c7; border: 1px solid #f59e0b; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 13px; color: #92400e; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
          th { background: #1a365d; color: white; padding: 12px; text-align: left; font-size: 12px; }
          th:nth-child(2), th:nth-child(3), th:nth-child(4) { text-align: right; }
          .line-date { font-size: 11px; color: #4a5568; margin-top: 2px; }
          td { padding: 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
          td:nth-child(2), td:nth-child(3), td:nth-child(4) { text-align: right; }
          tr:nth-child(even) { background: #f7fafc; }
          .totals { display: flex; justify-content: flex-end; margin-bottom: 30px; }
          .totals-box { width: 300px; }
          .total-row { display: flex; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; }
          .total-label { font-weight: bold; }
          .total-final { background: #1a365d; color: white; font-size: 16px; }
          .balance-due { background: #c53030; color: white; font-size: 16px; }
          .balance-paid { background: #2f855a; color: white; font-size: 16px; }
          .terms { background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; margin-bottom: 30px; }
          .terms-label { font-size: 11px; font-weight: bold; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
          .terms-text { font-size: 13px; color: #334155; line-height: 1.5; }
          .notes { background: #fffbeb; padding: 16px; border-radius: 8px; border-left: 4px solid #d69e2e; margin-bottom: 30px; }
          .notes-label { font-size: 12px; font-weight: bold; color: #744210; margin-bottom: 8px; }
          .notes-text { font-size: 12px; color: #744210; }
          .payment-info { background: #ebf8ff; padding: 16px; border-radius: 8px; }
          .payment-title { font-size: 14px; font-weight: bold; color: #2c5282; margin-bottom: 8px; }
          .payment-text { font-size: 12px; color: #2c5282; line-height: 1.6; }
          .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #999; }
        `}</style>
      </head>
      <body>
        <PrintButton />

        <div className="page">
          {/* Warning banner - screen only */}
          {!resolvedCustomer.isLinked && (
            <div className="warning-banner no-print">
              ⚠️ Customer not linked — invoice using fallback name/address from proposal. 
              Link a customer record to the job for accurate invoicing.
            </div>
          )}

          <div className="header">
            <div>
              <div className="company-name">{legalName}</div>
              <div className="company-address">
                {companyContact.address}
                {companyContact.phone && `\n${companyContact.phone}`}
                {companyContact.email && `\n${companyContact.email}`}
              </div>
            </div>
            <div>
              <div className="invoice-title">INVOICE</div>
              <div className="invoice-meta">
                <span className="invoice-meta-label">Invoice #: </span>
                <span className="invoice-meta-value">{invoice.invoice_number}</span>
              </div>
              <div className="invoice-meta">
                <span className="invoice-meta-label">Date: </span>
                <span className="invoice-meta-value">{formatInvoiceDisplayDate(invoice.issued_at)}</span>
              </div>
              {invoice.due_at && (
                <div className="invoice-meta">
                  <span className="invoice-meta-label">Due Date: </span>
                  <span className="invoice-meta-value">{formatInvoiceDisplayDate(invoice.due_at)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="bill-to">
            <div className="bill-to-label">Bill To</div>
            <div className="bill-to-name">{resolvedCustomer.name}</div>
            <div className="bill-to-address">
              {resolvedCustomer.address}
              {resolvedCustomer.phone && `\n${formatPhone(resolvedCustomer.phone)}`}
              {resolvedCustomer.email && `\n${resolvedCustomer.email}`}
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.description}
                    {item.service_date ? <div className="line-date">{invoiceItemDateLabel(item.service_date)}</div> : null}
                  </td>
                  <td>{invoiceItemQtyLabel(item)}</td>
                  <td>{invoiceItemPriceLabel(item)}</td>
                  <td>{formatCurrency(item.line_total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="totals">
            <div className="totals-box">
              <div className="total-row">
                <span className="total-label">Subtotal</span>
                <span>{formatCurrency(invoice.subtotal_cents)}</span>
              </div>
              {doc.taxRows.map((row, i) => (
                <div key={`${i}-${row.label}`} className="total-row">
                  <span className="total-label">{row.label}</span>
                  <span>{formatCurrency(row.amountCents)}</span>
                </div>
              ))}
              <div className="total-row total-final">
                <span className="total-label">Total</span>
                <span>{formatCurrency(invoice.total_cents)}</span>
              </div>
              {appliedCents > 0 && (
                <div className="total-row">
                  <span className="total-label">Payments Applied</span>
                  <span>({formatCurrency(appliedCents)})</span>
                </div>
              )}
              <div className={`total-row ${isPaid ? 'balance-paid' : 'balance-due'}`}>
                <span className="total-label">Balance Due</span>
                <span>{isPaid ? 'PAID' : formatCurrency(balanceCents)}</span>
              </div>
            </div>
          </div>

          {/* Customer-facing Terms/Notes (public_note) */}
          {invoice.public_note && (
            <div className="terms">
              <div className="terms-label">Terms</div>
              <div className="terms-text">{invoice.public_note}</div>
            </div>
          )}

          {/* Legacy notes field - only show if no public_note */}
          {!invoice.public_note && invoice.notes && (
            <div className="notes">
              <div className="notes-label">Notes</div>
              <div className="notes-text">{invoice.notes}</div>
            </div>
          )}

          {!isPaid && (
            <div className="payment-info">
              <div className="payment-title">Payment Instructions</div>
              <div className="payment-text">
                Please make payment by the due date shown above.<br />
                Accepted payment methods: Check, Credit Card, ACH Bank Transfer<br /><br />
                For questions about this invoice, please contact us at:<br />
                {companyContact.phone || companyContact.email || 'our office'}
              </div>
            </div>
          )}

          <div className="footer">
            <div>Thank you for your business!</div>
            <div>{legalName} • {invoice.invoice_number}</div>
          </div>
        </div>

      </body>
    </html>
  )
}
