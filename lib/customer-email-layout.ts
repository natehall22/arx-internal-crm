/**
 * THE layout for a short branded email to a customer: the company's name (and logo when it has one), a heading, a few
 * plain paragraphs, optional label/value rows, at most ONE button, and a footer with the company's own contact details —
 * phone (tap to call), website, and the postal address (a maps link; CAN-SPAM wants the physical address) — plus an
 * unsubscribe link when the message is automatic. Customers only ever see the company's brand (lib/org-brand.ts), never
 * the product's. Pure (no server imports): renders HTML + plain text from the same inputs, everything escaped.
 *
 * Known Redundancy 39: the hand-built one-button emails (`renderInvoiceEmail`, `notifyCustomerOfFailedPayment`, the save-card
 * email, the office payment email) should move onto this when next touched.
 */
import { escapeHtml } from '@/lib/html'
import { telHref } from '@/lib/format'

export type EmailCompany = {
  /** How customers know the company ("Precision Maintenance"). */
  name: string
  phone: string
  email: string
  website: string
  /** Postal address on one line. */
  addressLine: string
  /** Absolute logo URL, or null. */
  logoUrl?: string | null
}

export type CustomerEmail = {
  company: EmailCompany
  /** Preview text some mail apps show beside the subject. */
  preheader?: string
  heading: string
  /** Paragraphs, plain text (newlines kept). */
  paragraphs: string[]
  rows?: Array<{ label: string; value: string }>
  button?: { label: string; href: string } | null
  /** Small print under the button (plain text). */
  footnote?: string | null
  /** Automatic messages carry one; a message the office sends by hand may not. */
  unsubscribeUrl?: string | null
}

const INK = '#1f2937'

/** Pure: "https://example.com" for what an owner typed ("example.com", "www.example.com", a full URL); '' when blank or not a web address. */
export function websiteHref(raw: string): string {
  const v = (raw || '').trim()
  if (!v) return ''
  const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`
  try {
    const u = new URL(withProto)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : ''
  } catch {
    return ''
  }
}

/** Pure: a Google Maps search link for a postal address ('' when there is none). */
export function mapsHref(address: string): string {
  const v = (address || '').trim()
  return v ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v)}` : ''
}

/** Only http(s) links are ever put in an href. */
function safeHref(href: string | null | undefined): string {
  if (!href) return ''
  return /^https?:\/\//i.test(href) || /^tel:\+?\d+$/.test(href) ? href : ''
}

export function renderCustomerEmail(m: CustomerEmail): { html: string; text: string } {
  const c = m.company
  const p = (s: string) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:${INK};white-space:pre-line;">${escapeHtml(s)}</p>`
  const rows = (m.rows ?? []).filter((r) => r.value)
  const rowsHtml = rows.length
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:4px 0 18px;">${rows
        .map(
          (r) =>
            `<tr><td style="padding:8px 12px 8px 0;font-size:15px;color:${INK};font-weight:700;vertical-align:top;white-space:nowrap;">${escapeHtml(r.label)}</td><td style="padding:8px 0;font-size:15px;color:${INK};white-space:pre-line;">${escapeHtml(r.value)}</td></tr>`
        )
        .join('')}</table>`
    : ''
  const buttonHref = safeHref(m.button?.href)
  const button =
    m.button && buttonHref
      ? `<p style="margin:8px 0 20px;"><a href="${escapeHtml(buttonHref)}" style="display:inline-block;background:#111827;color:#ffffff;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">${escapeHtml(m.button.label)}</a></p>`
      : ''
  const tel = telHref(c.phone)
  const site = websiteHref(c.website)
  const maps = mapsHref(c.addressLine)
  const link = (href: string, label: string) => `<a href="${escapeHtml(href)}" style="color:${INK};text-decoration:underline;">${escapeHtml(label)}</a>`
  const contact = [
    c.phone ? (tel ? link(tel, c.phone) : escapeHtml(c.phone)) : '',
    c.email ? link(`mailto:${c.email}`, c.email) : '',
    site ? link(site, c.website.replace(/^https?:\/\//i, '').replace(/\/$/, '')) : '',
  ].filter(Boolean)
  const unsubscribe = safeHref(m.unsubscribeUrl)
  const footer = [
    `<div style="font-weight:700;">${escapeHtml(c.name)}</div>`,
    c.addressLine ? `<div>${maps ? link(maps, c.addressLine) : escapeHtml(c.addressLine)}</div>` : '',
    contact.length ? `<div>${contact.join(' · ')}</div>` : '',
    unsubscribe ? `<div style="margin-top:10px;">${link(unsubscribe, 'Stop these automatic emails')}</div>` : '',
  ]
    .filter(Boolean)
    .join('')
  const logo = safeHref(c.logoUrl)
  const header = logo
    ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(c.name)}" style="max-height:56px;max-width:220px;display:block;margin-bottom:16px;">`
    : `<div style="font-size:20px;font-weight:700;color:${INK};margin-bottom:16px;">${escapeHtml(c.name)}</div>`
  const pre = m.preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(m.preheader)}</div>` : ''
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:${INK};background:#ffffff;">${pre}
  ${header}
  <h1 style="font-size:22px;line-height:1.3;margin:0 0 14px;color:${INK};">${escapeHtml(m.heading)}</h1>
  ${m.paragraphs.map(p).join('')}
  ${rowsHtml}
  ${button}
  ${m.footnote ? `<p style="margin:0 0 14px;font-size:14px;color:${INK};">${escapeHtml(m.footnote)}</p>` : ''}
  <div style="border-top:1px solid #d1d5db;margin-top:24px;padding-top:14px;font-size:13px;line-height:1.6;color:${INK};">${footer}</div>
</div>`
  const text = [
    c.name,
    '',
    m.heading,
    '',
    ...m.paragraphs.flatMap((s) => [s, '']),
    ...rows.map((r) => `${r.label}: ${r.value}`),
    ...(rows.length ? [''] : []),
    ...(m.button && buttonHref ? [`${m.button.label}: ${buttonHref}`, ''] : []),
    ...(m.footnote ? [m.footnote, ''] : []),
    '—',
    c.name,
    ...(c.addressLine ? [c.addressLine] : []),
    ...[c.phone, c.email, c.website].filter(Boolean),
    ...(unsubscribe ? ['', `Stop these automatic emails: ${unsubscribe}`] : []),
  ].join('\n')
  return { html, text }
}
