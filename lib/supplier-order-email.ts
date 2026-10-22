/**
 * The email a supplier receives for a purchase order, revision or cancellation.
 *
 * `composeSupplierOrderEmail` is pure — the preview shows exactly what it returns, and the send
 * route sends exactly that. `deliverSupplierOrderEmail` is the ONLY function that puts a PO on
 * the wire, and only POST /api/ops/jobs/[id]/supplier-orders/send may call it (a test enforces
 * that no other file imports it — no status change, cron or background job can send an order).
 */
import { getCrmEmailFrom } from '@/lib/crm-email-from'
import { formatDeliveryDate, type OrderSection, type SendKind, type SupplierRecord } from '@/lib/material-sourcing'

export type SupplierOrderSender = { id: string; name: string | null; email: string | null }

export type ComposedSupplierEmail = {
  from: string
  to: string
  cc: string[]
  replyTo: string | null
  subject: string
  text: string
  html: string
  attachmentName: string | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && EMAIL_RE.test(value.trim())
}

/** Supplier CCs + the sender, de-duplicated, never repeating the To address. */
export function orderCcList(supplier: SupplierRecord, sender: SupplierOrderSender): string[] {
  const to = (supplier.orderEmail ?? '').trim().toLowerCase()
  const seen = new Set<string>([to])
  const out: string[] = []
  for (const raw of [...supplier.ccEmails, sender.email ?? '']) {
    const e = (raw ?? '').trim()
    if (!isValidEmail(e)) continue
    const k = e.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function composeSupplierOrderEmail(args: {
  kind: SendKind
  supplier: SupplierRecord
  sender: SupplierOrderSender
  orgName: string
  orgPhone: string | null
  jobNumber: string
  poLabel: string
  subject: string
  deliveryDate: string | null
  deliveryAddress: string | null
  deliveryNotes: string | null
  note: string | null
  sections: OrderSection[]
  changes: string[]
}): ComposedSupplierEmail {
  const lines: string[] = []
  lines.push(`Hi ${args.supplier.name},`, '')
  if (args.kind === 'cancellation') {
    lines.push(`Please CANCEL purchase order ${args.poLabel} for job ${args.jobNumber}${args.deliveryAddress ? ` at ${args.deliveryAddress}` : ''}. Do not deliver it.`)
  } else if (args.kind === 'revision') {
    lines.push(`This REVISED purchase order ${args.poLabel} for job ${args.jobNumber} replaces the earlier one. The PDF is attached.`)
  } else {
    lines.push(`Please see the attached purchase order ${args.poLabel} for job ${args.jobNumber}.`)
  }
  lines.push('')
  if (args.kind !== 'cancellation') {
    lines.push(`Deliver on: ${formatDeliveryDate(args.deliveryDate)}`)
    if (args.deliveryAddress) lines.push(`Deliver to: ${args.deliveryAddress}`)
  }
  if (args.supplier.accountNumber) lines.push(`Account: ${args.supplier.accountNumber}`)
  if (args.supplier.defaultBranch) lines.push(`Branch: ${args.supplier.defaultBranch}`)
  if (args.kind !== 'cancellation' && args.deliveryNotes) lines.push(`Delivery notes: ${args.deliveryNotes}`)
  if (args.note) lines.push(`Note: ${args.note}`)

  if (args.changes.length > 0 && args.kind === 'revision') {
    lines.push('', 'What changed:')
    for (const c of args.changes) lines.push(`- ${c}`)
  }

  if (args.kind !== 'cancellation' && args.sections.length > 0) {
    lines.push('', 'Items (same as the attached PDF):')
    for (const section of args.sections) {
      lines.push(`${section.title}:`)
      for (const row of section.rows) lines.push(`- ${row.label}: ${row.qty || 'see PDF'}`)
    }
  }

  lines.push('', args.kind === 'cancellation' ? 'Please reply to confirm the cancellation.' : 'Please reply to confirm this order and the delivery date.')
  lines.push('', 'Thank you,')
  if (args.sender.name) lines.push(args.sender.name)
  lines.push([args.orgName, args.orgPhone].filter(Boolean).join(' · '))

  const text = lines.join('\n')
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#2c2c2a;line-height:1.5">${text
    .split('\n')
    .map((l) => (l === '' ? '<br>' : `<div>${escapeHtml(l)}</div>`))
    .join('')}</div>`

  return {
    from: getCrmEmailFrom(),
    to: (args.supplier.orderEmail ?? '').trim(),
    cc: orderCcList(args.supplier, args.sender),
    replyTo: isValidEmail(args.sender.email) ? args.sender.email.trim() : null,
    subject: args.subject,
    text,
    html,
    attachmentName: args.kind === 'cancellation' ? null : `PO ${args.poLabel}.pdf`.replace(/[^A-Za-z0-9 ._-]/g, '-'),
  }
}

/**
 * Puts one composed email on the wire. Throws on any SMTP problem — the caller logs the failure
 * and never marks anything ordered.
 */
export async function deliverSupplierOrderEmail(
  email: ComposedSupplierEmail,
  pdf: Buffer | null
): Promise<{ messageId: string | null }> {
  if (!process.env.SMTP_HOST) {
    throw new Error('Email is not set up on the server (SMTP_HOST missing)')
  }
  // Lazy import: keeps nodemailer out of anything that only composes/previews.
  const { getMailTransport } = await import('@/lib/setter-email')
  const info = await getMailTransport().sendMail({
    from: email.from,
    to: email.to,
    cc: email.cc.length > 0 ? email.cc : undefined,
    replyTo: email.replyTo ?? undefined,
    subject: email.subject,
    text: email.text,
    html: email.html,
    attachments:
      pdf && email.attachmentName ? [{ filename: email.attachmentName, content: pdf, contentType: 'application/pdf' }] : undefined,
  })
  const rejected = Array.isArray(info?.rejected) ? info.rejected : []
  if (rejected.length > 0) {
    throw new Error(`The mail server refused: ${rejected.join(', ')}`)
  }
  return { messageId: typeof info?.messageId === 'string' ? info.messageId : null }
}
