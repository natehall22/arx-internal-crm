/**
 * The completion certificate: ONE page-set (usually one page) that records who signed what, when and from where, with the
 * SHA-256 of the signed PDF. It is its OWN file, stored beside the signed document — the contract / change-order PDF is never
 * re-rendered or appended to (a signed PDF stays byte-identical; its hash is what the certificate quotes).
 *
 * Company brand only: the certificate carries the company's name, never the product's. Server-side (jsPDF, same library as the
 * change-order PDF). The text says what was recorded and nothing about legal effect.
 */
import { jsPDF } from 'jspdf'

import type { DocumentBrand } from '@/lib/org-brand'
import type { EnvelopeSigner, SigningEventRow } from '@/lib/signing/types'

export type CertificateInput = {
  brand: Pick<DocumentBrand, 'name' | 'legalName' | 'addressLine' | 'phone' | 'email'>
  /** The envelope id — the certificate's own reference number. */
  certificateId: string
  documentTitle: string
  documentNumber?: string | null
  /** SHA-256 of the signed PDF's bytes. */
  documentSha256: string
  /** When that hash was computed (it can be later than the signing for a document signed before the engine existed). */
  hashedAt: string
  provider: string
  providerRef?: string | null
  sentAt: string | null
  signers: EnvelopeSigner[]
  /** Per signer: where it was signed from. Keyed by role. */
  evidence: Partial<Record<'customer' | 'company', { ip?: string | null; userAgent?: string | null; consentVersion?: string | null; consentAt?: string | null }>>
  events: Array<Pick<SigningEventRow, 'event' | 'actor_type' | 'actor_name' | 'ip' | 'created_at'> & { meta?: Record<string, unknown> }>
  generatedAt: string
}

const INK: [number, number, number] = [31, 41, 55]
const MUTED: [number, number, number] = [75, 85, 99]

export const EVENT_LABELS: Record<string, string> = {
  sent: 'Sent for signature',
  resent: 'Link sent again',
  reminder_sent: 'Reminder sent',
  viewed: 'Opened by the signer',
  consent_given: 'Agreed to sign electronically',
  signed: 'Signed',
  declined: 'Declined to sign',
  voided: 'Voided',
  extended: 'Signing link extended',
  completed: 'Completed',
  certificate_issued: 'Certificate issued',
  copy_sent: 'Signed copy emailed',
  filed: 'Filed on the customer',
}

/** UTC, written out, so a reader anywhere reads the same moment: "2026-11-11 14:03:22 UTC". */
export function utcStamp(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
}

function device(ua: string | null | undefined): string {
  const v = String(ua ?? '').trim()
  return v ? (v.length > 110 ? `${v.slice(0, 107)}...` : v) : 'not recorded'
}

export function buildCertificatePdf(input: CertificateInput): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = 612
  const M = 48
  const maxW = W - M * 2
  let y = M

  const ensure = (h: number) => {
    if (y + h > 740) {
      doc.addPage()
      y = M
    }
  }
  const text = (s: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number; indent?: number } = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    doc.setFontSize(opts.size ?? 10)
    doc.setTextColor(...(opts.color ?? INK))
    const lines = doc.splitTextToSize(s, maxW - (opts.indent ?? 0)) as string[]
    for (const line of lines) {
      ensure((opts.size ?? 10) + 4)
      doc.text(line, M + (opts.indent ?? 0), y)
      y += (opts.size ?? 10) + 3
    }
    y += opts.gap ?? 0
  }
  const rule = () => {
    ensure(10)
    doc.setDrawColor(200, 205, 212)
    doc.line(M, y, W - M, y)
    y += 12
  }

  text(input.brand.legalName || input.brand.name, { size: 11, bold: true, color: MUTED })
  text('Certificate of Completion', { size: 22, bold: true, gap: 4 })
  text(`Certificate reference: ${input.certificateId}`, { size: 9, color: MUTED })
  text(`Issued: ${utcStamp(input.generatedAt)}`, { size: 9, color: MUTED, gap: 8 })
  rule()

  text('Document', { size: 12, bold: true, gap: 2 })
  text(input.documentTitle, { size: 11 })
  if (input.documentNumber) text(`Number: ${input.documentNumber}`, { size: 10 })
  text('SHA-256 of the signed PDF:', { size: 9, color: MUTED })
  text(input.documentSha256, { size: 9, bold: true })
  text(`Fingerprint recorded: ${utcStamp(input.hashedAt)}. Computing the SHA-256 of the stored PDF today gives the same value if the file is unchanged.`, { size: 8.5, color: MUTED, gap: 4 })
  text(`Sent: ${utcStamp(input.sentAt)}    Carried by: ${input.provider}${input.providerRef ? ` (${input.providerRef})` : ''}`, { size: 9, color: MUTED, gap: 6 })
  rule()

  text('Signers', { size: 12, bold: true, gap: 2 })
  for (const s of [...input.signers].sort((a, b) => a.order - b.order)) {
    const ev = input.evidence[s.role] ?? {}
    ensure(70)
    text(`${s.name || '(no name)'} — ${s.role === 'company' ? 'company representative' : 'customer'}`, { size: 10.5, bold: true })
    if (s.email) text(`Email: ${s.email}`, { size: 9.5, indent: 10 })
    text(`Status: ${s.status === 'signed' ? 'Signed' : s.status === 'declined' ? 'Declined' : 'Not signed'}${s.signedAt ? ` on ${utcStamp(s.signedAt)}` : ''}`, { size: 9.5, indent: 10 })
    if (ev.ip) text(`From IP address: ${ev.ip}`, { size: 9.5, indent: 10 })
    if (ev.ip || ev.userAgent) text(`Device / browser: ${device(ev.userAgent)}`, { size: 9.5, indent: 10 })
    if (ev.consentVersion) text(`Agreed to sign electronically (notice ${ev.consentVersion})${ev.consentAt ? ` on ${utcStamp(ev.consentAt)}` : ''}`, { size: 9.5, indent: 10 })
    y += 4
  }
  rule()

  text('Record of events', { size: 12, bold: true, gap: 2 })
  const events = [...input.events].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  for (const e of events) {
    const who = e.actor_name ? ` — ${e.actor_name}` : e.actor_type === 'system' ? '' : ` — ${e.actor_type}`
    const reason = typeof e.meta?.reason === 'string' && e.meta.reason ? ` ("${String(e.meta.reason).slice(0, 200)}")` : ''
    text(`${utcStamp(e.created_at)}   ${EVENT_LABELS[e.event] ?? e.event}${who}${e.ip ? `   IP ${e.ip}` : ''}${reason}`, { size: 9 })
  }
  if (events.length === 0) text('No events were recorded before this certificate was issued.', { size: 9, color: MUTED })
  y += 6
  rule()

  text(
    'This certificate lists the events recorded for the document above and the fingerprint (SHA-256) of the signed PDF. It does not change the document. Times are UTC.',
    { size: 8.5, color: MUTED, gap: 4 }
  )
  const contact = [input.brand.phone, input.brand.email].filter(Boolean).join('  |  ')
  text(`${input.brand.name}${input.brand.addressLine ? ` — ${input.brand.addressLine}` : ''}${contact ? `  |  ${contact}` : ''}`, { size: 8.5, color: MUTED })

  return Buffer.from(doc.output('arraybuffer'))
}
