import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { redirect } from 'next/navigation'
import PrintButton from './PrintButton'

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const date = new Date(dateStr + 'T12:00:00')
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default async function PrintInvoicePage({
  params,
}: {
  params: { invoiceId: string }
}) {
  const supabase = createClient()
  const adminClient = createServiceClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await adminClient
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (!profile) {
    redirect('/login')
  }

  // Get invoice with all details
  const { data: invoice } = await adminClient
    .from('job_invoices')
    .select(`
      *,
      production_jobs!inner(
        org_id,
        job_number,
        address_text,
        customer:customers(name, email, phone, address_text),
        project:projects(address_text)
      )
    `)
    .eq('id', params.invoiceId)
    .single()

  if (!invoice || (invoice as any).production_jobs?.org_id !== profile.org_id) {
    return <div className="p-8 text-center">Invoice not found</div>
  }

  // Get line items
  const { data: items } = await adminClient
    .from('job_invoice_items')
    .select('*')
    .eq('invoice_id', invoice.id)
    .order('sort_order', { ascending: true })

  // Get applied payments
  const { data: applications } = await adminClient
    .from('invoice_payments')
    .select('applied_cents')
    .eq('invoice_id', invoice.id)

  const appliedCents = (applications || []).reduce(
    (sum: number, a: any) => sum + a.applied_cents,
    0
  )

  // Get org settings
  const { data: org } = await adminClient
    .from('orgs')
    .select('name, address, city, state, zip, phone, email')
    .eq('id', profile.org_id)
    .single()

  const job = (invoice as any).production_jobs
  const customer = Array.isArray(job.customer) ? job.customer[0] : job.customer
  const project = Array.isArray(job.project) ? job.project[0] : job.project

  const companyAddress = [
    org?.address,
    org?.city && org?.state ? `${org.city}, ${org.state} ${org.zip || ''}`.trim() : null,
  ].filter(Boolean).join('\n')

  const customerAddress = customer?.address_text || project?.address_text || job.address_text || ''
  const balanceCents = invoice.total_cents - appliedCents
  const isPaid = balanceCents <= 0

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
          table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
          th { background: #1a365d; color: white; padding: 12px; text-align: left; font-size: 12px; }
          th:nth-child(2), th:nth-child(3), th:nth-child(4) { text-align: right; }
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
          .notes { background: #fffbeb; padding: 16px; border-radius: 8px; border-left: 4px solid #d69e2e; margin-bottom: 30px; }
          .notes-label { font-size: 12px; font-weight: bold; color: #744210; margin-bottom: 8px; }
          .notes-text { font-size: 12px; color: #744210; }
          .payment-info { background: #ebf8ff; padding: 16px; border-radius: 8px; }
          .payment-title { font-size: 14px; font-weight: bold; color: #2c5282; margin-bottom: 8px; }
          .payment-text { font-size: 12px; color: #2c5282; line-height: 1.6; }
          .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #999; }
          .print-btn { position: fixed; top: 20px; right: 20px; padding: 12px 24px; background: #4f46e5; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; }
          .print-btn:hover { background: #4338ca; }
        `}</style>
      </head>
      <body>
        <PrintButton />

        <div className="page">
          <div className="header">
            <div>
              <div className="company-name">{org?.name || 'ARX Roofing & Exteriors, LLC'}</div>
              <div className="company-address">
                {companyAddress || '123 Main Street\nCity, State 12345'}
                {org?.phone && `\n${org.phone}`}
                {org?.email && `\n${org.email}`}
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
                <span className="invoice-meta-value">{formatDate(invoice.issued_at)}</span>
              </div>
              {invoice.due_at && (
                <div className="invoice-meta">
                  <span className="invoice-meta-label">Due Date: </span>
                  <span className="invoice-meta-value">{formatDate(invoice.due_at)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="bill-to">
            <div className="bill-to-label">Bill To</div>
            <div className="bill-to-name">{customer?.name || 'Customer'}</div>
            <div className="bill-to-address">
              {customerAddress}
              {customer?.phone && `\n${customer.phone}`}
              {customer?.email && `\n${customer.email}`}
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
              {(items || []).map((item: any) => (
                <tr key={item.id}>
                  <td>{item.description}</td>
                  <td>{item.qty}</td>
                  <td>{formatCurrency(item.unit_price_cents)}</td>
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

          {invoice.notes && (
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
                {org?.phone || org?.email || 'our office'}
              </div>
            </div>
          )}

          <div className="footer">
            <div>Thank you for your business!</div>
            <div>{org?.name || 'ARX Roofing & Exteriors, LLC'} • {invoice.invoice_number}</div>
          </div>
        </div>

      </body>
    </html>
  )
}
