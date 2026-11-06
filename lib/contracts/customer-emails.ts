/**
 * Customer emails for agreements and change orders (ready to sign / signed). Pure builders so the copy can be
 * golden-tested; the company identity comes from the org brand (`brandDocument`), never a literal.
 * Phone: these emails show the COMPANY phone, as they always have (byte-identical for the original company).
 * Values put into HTML go through escapeHtml.
 */
import { escapeHtml } from '@/lib/html'
import type { DocumentBrand } from '@/lib/org-brand'

export interface BuiltEmail {
  subject: string
  text: string
  html: string
}

const CONTINGENCY_AMOUNT = 'Not required until final Installation Agreement'

/** Sent by POST /api/contracts/create when the rep sends an agreement for remote signature. */
export function buildContractReadyEmail(args: {
  brand: DocumentBrand
  agreementLabel: string
  customerName: string
  signingUrl: string
  projectAddress: string
  isContingency: boolean
  projectCost: number
  repName: string
}): BuiltEmail {
  const { brand, agreementLabel, signingUrl, isContingency, projectCost } = args
  const amount = !isContingency ? `$${projectCost.toLocaleString()}` : CONTINGENCY_AMOUNT
  const h = {
    name: escapeHtml(args.customerName),
    label: escapeHtml(agreementLabel),
    url: escapeHtml(signingUrl),
    address: escapeHtml(args.projectAddress),
    rep: escapeHtml(args.repName),
    email: escapeHtml(brand.email),
  }
  return {
    subject: `${brand.casualName} - Your ${agreementLabel} is Ready to Sign`,
    text: `Hi ${args.customerName},

Your ${agreementLabel} is ready. Please review and sign it using the link below:

${signingUrl}

Project: ${args.projectAddress}
${!isContingency ? `Amount: $${projectCost.toLocaleString()}` : `Amount: ${CONTINGENCY_AMOUNT}`}

This link expires in 7 days.

Questions? Call ${brand.phone} or email ${brand.email}

- ${args.repName}, ${brand.name}`,
    html: `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f4f4f4;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:20px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">

<tr><td style="background:#1e3a5f;padding:20px;text-align:center;">
<h1 style="margin:0;color:#ffffff;font-size:20px;">${escapeHtml(brand.nameUpper)}</h1>
</td></tr>

<tr><td style="padding:30px 30px 20px 30px;">
<p style="margin:0 0 15px 0;font-size:16px;color:#333;">Hi ${h.name},</p>
<p style="margin:0 0 25px 0;font-size:16px;color:#333;">Your ${h.label} is ready for signature. Click below to review and sign:</p>
</td></tr>

<tr><td align="center" style="padding:0 30px 25px 30px;">
<table cellpadding="0" cellspacing="0"><tr>
<td style="background:#22c55e;border-radius:6px;padding:14px 32px;">
<a href="${h.url}" style="color:#ffffff;text-decoration:none;font-size:18px;font-weight:bold;display:block;">Review & Sign Agreement</a>
</td>
</tr></table>
</td></tr>

<tr><td style="padding:0 30px 20px 30px;">
<table width="100%" cellpadding="12" cellspacing="0" style="background:#f9f9f9;border-radius:6px;">
<tr><td style="font-size:14px;color:#666;">
<strong style="color:#333;">Project:</strong> ${h.address}<br>
<strong style="color:#333;">Agreement:</strong> ${h.label}<br>
<strong style="color:#333;">Amount:</strong> ${escapeHtml(amount)}
</td></tr>
</table>
</td></tr>

<tr><td style="padding:0 30px 25px 30px;">
<p style="margin:0;font-size:13px;color:#999;">This link expires in 7 days.</p>
</td></tr>

<tr><td style="padding:20px 30px;border-top:1px solid #eee;font-size:13px;color:#666;">
Questions? <strong>${escapeHtml(brand.phone)}</strong> or <a href="mailto:${h.email}" style="color:#1e3a5f;">${h.email}</a><br><br>
${h.rep}<br>${escapeHtml(brand.legalName)}
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`,
  }
}

/** Sent by POST /api/contracts/sign once the customer has signed. */
export function buildContractSignedEmail(args: {
  brand: DocumentBrand
  agreementLabel: string
  customerName: string
  projectAddress: string
  isContingency: boolean
  projectCost: number
  /** Customer link to the signed copy, or null while the PDF is still processing. */
  customerPdfUrl: string | null
}): BuiltEmail {
  const { brand, agreementLabel, customerPdfUrl, isContingency, projectCost } = args
  const pdfSection = customerPdfUrl
    ? `<p style="text-align: center;">
            <a href="${escapeHtml(customerPdfUrl)}" style="display: inline-block; background: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0;">Download Signed Agreement</a>
          </p>`
    : `<p style="background: #fef3c7; padding: 12px; border-radius: 6px; color: #92400e;">
            Your signed agreement is being processed. A copy will be sent to you shortly, or you can contact us to request one.
          </p>`

  const pdfTextSection = customerPdfUrl
    ? `You can download your signed agreement here:\n${customerPdfUrl}`
    : `Your signed agreement is being processed. Please contact us if you need a copy.`

  const text = `Dear ${args.customerName},

Thank you for signing your ${agreementLabel} with ${brand.name}!

${pdfTextSection}

Project Details:
- Address: ${args.projectAddress}
${isContingency ? `- Project Cost: ${CONTINGENCY_AMOUNT}` : `- Project Cost: $${projectCost.toLocaleString()}`}

We look forward to working with you!

If you have any questions, please contact us at:
Phone: ${brand.phone}
Email: ${brand.email}

Best regards,
${brand.legalName}`

  const legal = escapeHtml(brand.legalName)
  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #1e3a5f; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; background: #f9f9f9; }
    .details { background: white; padding: 15px; border-radius: 6px; margin: 15px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">${escapeHtml(brand.legalNameUpper)}</h1>
      <p style="margin: 5px 0 0 0; opacity: 0.9;">Agreement Signed Successfully!</p>
    </div>
    <div class="content">
      <p>Dear ${escapeHtml(args.customerName)},</p>
      <p>Thank you for signing your ${escapeHtml(agreementLabel)} with ${escapeHtml(brand.name)}!</p>

      <div class="details">
        <strong>Project Details:</strong><br>
        Address: ${escapeHtml(args.projectAddress)}<br>
        Project Cost: ${isContingency ? CONTINGENCY_AMOUNT : `$${projectCost.toLocaleString()}`}
      </div>

      ${pdfSection}

      <p>We look forward to working with you!</p>

      <p>If you have any questions, please contact us:</p>
      <p>
        Phone: ${escapeHtml(brand.phone)}<br>
        Email: ${escapeHtml(brand.email)}
      </p>

      <p>Best regards,<br>${legal}</p>
    </div>
    <div class="footer">
      <p>${legal}<br>
      ${escapeHtml(brand.addressLine)}<br>
      ${escapeHtml(brand.website)}</p>
    </div>
  </div>
</body>
</html>`

  return { subject: `${brand.name} - Your Signed ${agreementLabel}`, text, html }
}

/** Sent by POST /api/change-orders/create when a change order goes to the customer for remote signature. */
export function buildChangeOrderReadyEmail(args: {
  brand: DocumentBrand
  coNumber: string
  customerName: string
  signingUrl: string
  projectAddress: string
  updatedTotal: number | null | undefined
  repName: string
}): BuiltEmail {
  const { brand } = args
  const total = Number(args.updatedTotal || 0).toLocaleString()
  return {
    subject: `Please sign Change Order ${args.coNumber}`,
    text: `Hi ${args.customerName},\n\nYour change order is ready for signature.\n\nPlease review and sign here:\n${args.signingUrl}\n\nProject: ${args.projectAddress}\nUpdated Total: $${total}\n\nIf you have questions, call ${brand.phone}.\n\n- ${args.repName}, ${brand.name}`,
    html: `<p>Hi ${escapeHtml(args.customerName)},</p><p>Your change order is ready for signature.</p><p><a href="${escapeHtml(args.signingUrl)}">Review & Sign Change Order</a></p><p><strong>Project:</strong> ${escapeHtml(args.projectAddress)}<br/><strong>Updated Total:</strong> $${total}</p><p>If you have questions, call ${escapeHtml(brand.phone)}.</p><p>- ${escapeHtml(args.repName)}, ${escapeHtml(brand.name)}</p>`,
  }
}

/** Sent by POST /api/change-orders/sign once the customer has signed. */
export function buildChangeOrderSignedEmail(args: {
  brand: DocumentBrand
  coNumber: string
  customerPdfUrl: string | null
}): BuiltEmail {
  const { brand, customerPdfUrl } = args
  return {
    subject: `Signed Change Order ${args.coNumber}`,
    text: `Thank you for signing your change order.\n\n${customerPdfUrl ? `Signed copy: ${customerPdfUrl}\n\n` : ''}${brand.name}`,
    html: `<p>Thank you for signing your change order.</p>${customerPdfUrl ? `<p><a href="${escapeHtml(customerPdfUrl)}">Download signed copy</a></p>` : ''}<p>${escapeHtml(brand.name)}</p>`,
  }
}
