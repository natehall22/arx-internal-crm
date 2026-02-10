import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// POST: Generate a PDF (proposal, contract, change order, invoice)
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const jobId = params.id
  const body = await request.json()
  const { type = 'proposal', estimate_id } = body

  // Get user's org
  const { data: profile } = await supabase
    .from('users')
    .select('org_id, full_name')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  // Get job with customer info
  const { data: job } = await supabase
    .from('jobs')
    .select(`
      *,
      customer:customers(name, phone, email, address_text),
      lead:leads(homeowner_name, phone, email, address_text)
    `)
    .eq('id', jobId)
    .eq('org_id', profile.org_id)
    .single()

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  // Get org settings for branding
  const { data: org } = await supabase
    .from('orgs')
    .select('name')
    .eq('id', profile.org_id)
    .single()

  // Get estimate data if generating proposal
  let estimate = null
  let estimateLines = null

  if (type === 'proposal' && estimate_id) {
    const { data: estimateData } = await supabase
      .from('estimates')
      .select('*')
      .eq('id', estimate_id)
      .eq('job_id', jobId)
      .single()

    if (estimateData) {
      estimate = estimateData

      const { data: lines } = await supabase
        .from('estimate_lines')
        .select('*')
        .eq('estimate_id', estimate_id)
        .order('sort_order')

      estimateLines = lines
    }
  }

  // Generate PDF content (HTML that will be converted to PDF)
  const customerName = job.customer?.name || job.lead?.homeowner_name || 'Customer'
  const customerAddress = job.customer?.address_text || job.lead?.address_text || job.address_text || ''
  const customerPhone = job.customer?.phone || job.lead?.phone || ''
  const customerEmail = job.customer?.email || job.lead?.email || ''

  const pdfHtml = generatePdfHtml({
    type,
    orgName: org?.name || 'Company',
    customerName,
    customerAddress,
    customerPhone,
    customerEmail,
    job,
    estimate,
    estimateLines: estimateLines ?? [],
    generatedBy: profile.full_name,
    generatedAt: new Date(),
  })

  // Convert HTML to PDF using a service or library
  // For now, we'll use a simple approach with jsPDF on the client
  // In production, you'd use something like Puppeteer, wkhtmltopdf, or a PDF service

  // Generate storage key
  const { data: versionData } = await supabase.rpc('get_next_job_file_version', {
    p_job_id: jobId,
    p_file_type: type,
  })

  const version = versionData || 1
  const storageKey = version === 1
    ? `orgs/${profile.org_id}/jobs/${jobId}/${type}.pdf`
    : `orgs/${profile.org_id}/jobs/${jobId}/${type}_v${version}.pdf`

  // For now, return the HTML and let the client generate the PDF
  // In a production setup, you'd generate the PDF server-side
  return NextResponse.json({
    html: pdfHtml,
    storage_key: storageKey,
    file_name: `${type.charAt(0).toUpperCase() + type.slice(1)} - ${customerName}.pdf`,
    file_type: type,
    version,
    metadata: {
      org_id: profile.org_id,
      job_id: jobId,
      customer_name: customerName,
      generated_by: profile.full_name,
      generated_at: new Date().toISOString(),
    },
  })
}

interface PdfData {
  type: string
  orgName: string
  customerName: string
  customerAddress: string
  customerPhone: string
  customerEmail: string
  job: any
  estimate: any
  estimateLines: any[]
  generatedBy: string
  generatedAt: Date
}

function generatePdfHtml(data: PdfData): string {
  const {
    type,
    orgName,
    customerName,
    customerAddress,
    customerPhone,
    customerEmail,
    job,
    estimate,
    estimateLines,
    generatedBy,
    generatedAt,
  } = data

  const formatCurrency = (amount: number) => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0)

  const formatDate = (date: Date) =>
    date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  if (type === 'proposal') {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; line-height: 1.5; }
    .page { padding: 40px; max-width: 800px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 2px solid #4F46E5; }
    .company-name { font-size: 28px; font-weight: bold; color: #4F46E5; }
    .document-title { font-size: 24px; color: #666; text-align: right; }
    .document-date { font-size: 14px; color: #888; text-align: right; margin-top: 5px; }
    .customer-section { margin-bottom: 30px; }
    .section-title { font-size: 12px; text-transform: uppercase; color: #888; margin-bottom: 8px; letter-spacing: 1px; }
    .customer-name { font-size: 18px; font-weight: 600; }
    .customer-details { color: #666; font-size: 14px; }
    .job-details { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
    .job-details h3 { margin-bottom: 10px; color: #333; }
    .job-details p { color: #666; font-size: 14px; }
    .line-items { margin-bottom: 30px; }
    .line-items table { width: 100%; border-collapse: collapse; }
    .line-items th { text-align: left; padding: 12px; background: #f1f5f9; font-size: 12px; text-transform: uppercase; color: #666; }
    .line-items td { padding: 12px; border-bottom: 1px solid #e5e7eb; }
    .line-items .amount { text-align: right; }
    .totals { margin-left: auto; width: 300px; }
    .totals-row { display: flex; justify-content: space-between; padding: 8px 0; }
    .totals-row.total { font-size: 18px; font-weight: bold; border-top: 2px solid #333; padding-top: 12px; margin-top: 8px; }
    .scope { margin-bottom: 30px; }
    .scope-content { background: #f8f9fa; padding: 20px; border-radius: 8px; white-space: pre-wrap; font-size: 14px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #888; }
    .signature-section { margin-top: 40px; display: flex; gap: 40px; }
    .signature-box { flex: 1; }
    .signature-line { border-bottom: 1px solid #333; height: 40px; margin-bottom: 5px; }
    .signature-label { font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="company-name">${orgName}</div>
      <div>
        <div class="document-title">Proposal</div>
        <div class="document-date">${formatDate(generatedAt)}</div>
      </div>
    </div>

    <div class="customer-section">
      <div class="section-title">Prepared For</div>
      <div class="customer-name">${customerName}</div>
      <div class="customer-details">
        ${customerAddress ? `<div>${customerAddress}</div>` : ''}
        ${customerPhone ? `<div>${customerPhone}</div>` : ''}
        ${customerEmail ? `<div>${customerEmail}</div>` : ''}
      </div>
    </div>

    <div class="job-details">
      <h3>Project Details</h3>
      <p><strong>Address:</strong> ${job.address_text || customerAddress}</p>
      <p><strong>Type:</strong> ${job.job_type?.charAt(0).toUpperCase() + job.job_type?.slice(1) || 'Roofing'}</p>
      ${job.roof_squares ? `<p><strong>Roof Size:</strong> ${job.roof_squares} squares</p>` : ''}
    </div>

    ${estimateLines && estimateLines.length > 0 ? `
    <div class="line-items">
      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th>Qty</th>
            <th>Unit</th>
            <th class="amount">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${estimateLines.map(line => `
            <tr>
              <td>${line.name}</td>
              <td>${line.qty}</td>
              <td>${line.unit}</td>
              <td class="amount">${formatCurrency(line.line_total)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="totals">
      <div class="totals-row">
        <span>Subtotal</span>
        <span>${formatCurrency(estimate?.subtotal)}</span>
      </div>
      ${estimate?.discount_amount > 0 ? `
      <div class="totals-row">
        <span>Discount</span>
        <span>-${formatCurrency(estimate?.discount_amount)}</span>
      </div>
      ` : ''}
      <div class="totals-row">
        <span>Tax</span>
        <span>${formatCurrency(estimate?.tax)}</span>
      </div>
      <div class="totals-row total">
        <span>Total</span>
        <span>${formatCurrency(estimate?.total)}</span>
      </div>
    </div>
    ` : ''}

    ${estimate?.scope_text ? `
    <div class="scope">
      <div class="section-title">Scope of Work</div>
      <div class="scope-content">${estimate.scope_text}</div>
    </div>
    ` : ''}

    <div class="signature-section">
      <div class="signature-box">
        <div class="signature-line"></div>
        <div class="signature-label">Customer Signature</div>
      </div>
      <div class="signature-box">
        <div class="signature-line"></div>
        <div class="signature-label">Date</div>
      </div>
    </div>

    <div class="footer">
      <p>Prepared by ${generatedBy} on ${formatDate(generatedAt)}</p>
      <p>This proposal is valid for 30 days from the date above.</p>
    </div>
  </div>
</body>
</html>
    `
  }

  if (type === 'contract') {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #333; line-height: 1.6; font-size: 14px; }
    .page { padding: 40px; max-width: 800px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #333; }
    .company-name { font-size: 24px; font-weight: bold; }
    .document-title { font-size: 20px; margin-top: 10px; }
    .parties { margin-bottom: 30px; }
    .party { margin-bottom: 15px; }
    .party-label { font-weight: bold; }
    .section { margin-bottom: 25px; }
    .section-title { font-weight: bold; margin-bottom: 10px; }
    .terms { margin-bottom: 30px; }
    .terms ol { padding-left: 20px; }
    .terms li { margin-bottom: 10px; }
    .signature-section { margin-top: 50px; }
    .signature-row { display: flex; gap: 40px; margin-bottom: 30px; }
    .signature-box { flex: 1; }
    .signature-line { border-bottom: 1px solid #333; height: 30px; margin-bottom: 5px; }
    .signature-label { font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="company-name">${orgName}</div>
      <div class="document-title">SERVICE CONTRACT</div>
    </div>

    <div class="parties">
      <div class="party">
        <span class="party-label">Contractor:</span> ${orgName}
      </div>
      <div class="party">
        <span class="party-label">Customer:</span> ${customerName}
      </div>
      <div class="party">
        <span class="party-label">Property Address:</span> ${job.address_text || customerAddress}
      </div>
      <div class="party">
        <span class="party-label">Date:</span> ${formatDate(generatedAt)}
      </div>
    </div>

    <div class="section">
      <div class="section-title">Scope of Work</div>
      <p>${estimate?.scope_text || 'As described in the attached proposal.'}</p>
    </div>

    <div class="section">
      <div class="section-title">Contract Amount</div>
      <p><strong>${formatCurrency(estimate?.total || 0)}</strong></p>
    </div>

    <div class="terms">
      <div class="section-title">Terms and Conditions</div>
      <ol>
        <li>Payment terms: 50% deposit due upon signing, balance due upon completion.</li>
        <li>Work will commence within 5-10 business days of signed contract and deposit.</li>
        <li>All work is guaranteed for a period of one (1) year from completion.</li>
        <li>Customer agrees to provide access to the property during work hours.</li>
        <li>Any changes to the scope of work must be agreed upon in writing.</li>
        <li>Contractor is fully licensed and insured.</li>
      </ol>
    </div>

    <div class="signature-section">
      <div class="signature-row">
        <div class="signature-box">
          <div class="signature-line"></div>
          <div class="signature-label">Customer Signature</div>
        </div>
        <div class="signature-box">
          <div class="signature-line"></div>
          <div class="signature-label">Date</div>
        </div>
      </div>
      <div class="signature-row">
        <div class="signature-box">
          <div class="signature-line"></div>
          <div class="signature-label">Customer Printed Name</div>
        </div>
        <div class="signature-box">
          <div class="signature-line"></div>
          <div class="signature-label">Phone</div>
        </div>
      </div>
      <div class="signature-row">
        <div class="signature-box">
          <div class="signature-line"></div>
          <div class="signature-label">Contractor Signature</div>
        </div>
        <div class="signature-box">
          <div class="signature-line"></div>
          <div class="signature-label">Date</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
    `
  }

  // Default/change order template
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; padding: 40px; }
    .header { margin-bottom: 30px; }
    .title { font-size: 24px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">${orgName} - ${type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')}</div>
    <div>Date: ${formatDate(generatedAt)}</div>
    <div>Customer: ${customerName}</div>
  </div>
  <div class="content">
    <p>Document content goes here.</p>
  </div>
</body>
</html>
  `
}
