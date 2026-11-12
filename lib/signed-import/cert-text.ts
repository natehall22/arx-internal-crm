/**
 * Move signed documents — what a signing tool's certificate (or the signed PDF's own text) says: the envelope id, who
 * signed, when. Pure. The text comes from `pdf-text.ts`; here it is only read.
 *
 * UNVERIFIED against real exports: the spellings below come from the tools' public documentation and sample
 * certificates, not from this company's files. Every value is a HINT — it narrows who a document belongs to and fills in
 * dates, and the owner still confirms each match on the screen. A missing value is simply missing, never guessed.
 */
import type { SignedImportSource } from './files'

export type CertFacts = {
  provider: SignedImportSource | null
  envelopeId: string | null
  emails: string[]
  names: string[]
  sentOn: string | null
  completedOn: string | null
  /** The text itself says the signing is NOT finished (Status: Sent / Declined / Voided …). */
  notCompleted: boolean
  /** Reads like a certificate / audit trail / summary page rather than the agreement. */
  isCertificate: boolean
}

const UUID = '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}'
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})+/g
/** The tools' own addresses (support, no-reply, notifications): never a customer. */
const SYSTEM_EMAIL = /@(?:[a-z0-9.-]*\.)?(?:docusign|dropbox|hellosign|pandadoc|signnow|adobe|echosign)\.(?:com|net)$|^(?:no-?reply|do-?not-?reply|support|notifications?)@/i

export function emailsIn(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.match(EMAIL) ?? []) {
    const e = m.toLowerCase().replace(/[.,;:)]+$/, '')
    if (e.length <= 254 && !SYSTEM_EMAIL.test(e)) out.add(e)
  }
  return Array.from(out)
}

export function providerOf(text: string): SignedImportSource | null {
  if (/docusign/i.test(text)) return 'docusign'
  if (/dropbox\s*sign|hellosign/i.test(text)) return 'dropbox_sign'
  if (/pandadoc/i.test(text)) return 'pandadoc'
  return null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')
const valid = (y: number, m: number, d: number) => y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31

/** "2024-03-04", "3/4/2024 5:06 PM" (US order; a first number over 12 is taken as the day), "Mar 4, 2024", "4 March 2024" → "2024-03-04". */
export function dateOn(s: string): string | null {
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m && valid(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`
  m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)
  if (m) {
    let mo = +m[1]
    let d = +m[2]
    if (mo > 12 && d <= 12) [mo, d] = [d, mo]
    if (valid(+m[3], mo, d)) return `${m[3]}-${pad(mo)}-${pad(d)}`
  }
  m = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(s)
  if (m) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1
    if (mo && valid(+m[3], mo, +m[2])) return `${m[3]}-${pad(mo)}-${pad(+m[2])}`
  }
  m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/.exec(s)
  if (m) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1
    if (mo && valid(+m[3], mo, +m[1])) return `${m[3]}-${pad(mo)}-${pad(+m[1])}`
  }
  return null
}

/** A line that is plausibly a person's name: 2–4 words, each capitalised, letters only (no digits, no "@"). */
function nameLike(line: string): string | null {
  const t = line.trim().replace(/\s+/g, ' ')
  if (t.length < 4 || t.length > 60) return null
  const words = t.split(' ')
  if (words.length < 2 || words.length > 4) return null
  if (!words.every((w) => /^[A-Z][A-Za-z'’.-]+$/.test(w))) return null
  if (/^(Certificate|Envelope|Signer|Signature|Security|Status|Holder|Timestamp|Record|Electronic|Sent|Viewed|Signed|Completed|Document|Page|Audit|Trail|Original|Copy|In Person|Carbon|Witness|Notary|Payment|Events|Summary|Details)\b/i.test(t)) return null
  return t
}

export function readCertificateText(text: string): CertFacts {
  const flat = text.replace(/ /g, ' ')
  const lines = flat.split(/\r?\n/)

  let envelopeId: string | null = null
  const docusign = new RegExp(`(?:DocuSign\\s+)?Envelope\\s*(?:Id|ID)\\s*[:#]?\\s*(${UUID})`, 'i').exec(flat)
  const hello = /(?:Signature\s*request|Document)\s*(?:Id|ID)\s*[:#]?\s*([0-9a-f]{40})\b/i.exec(flat)
  const generic = /(?:Envelope|Document|Request|Transaction)\s*(?:Id|ID)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{11,63})\b/.exec(flat)
  if (docusign) envelopeId = docusign[1].toUpperCase()
  else if (hello) envelopeId = hello[1].toLowerCase()
  else if (generic) envelopeId = generic[1]

  const emails = emailsIn(flat)

  // Names: the line just before a line that holds an email (the usual signer block: name, then address).
  const names = new Set<string>()
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].includes('@') && emailsIn(lines[i]).length) {
      const n = nameLike(lines[i - 1])
      if (n) names.add(n)
    }
    // "Name: Jane Smith" / "Signer: Jane Smith" / "Signed by: Jane Smith"
    const labelled = /^\s*(?:Name|Signer|Signed by|Recipient)\s*[:\-]\s*(.{3,60})$/i.exec(lines[i])
    if (labelled) {
      const n = nameLike(labelled[1])
      if (n) names.add(n)
    }
  }

  const dateAfter = (label: RegExp): string | null => {
    for (let i = 0; i < lines.length; i++) {
      const m = label.exec(lines[i])
      if (!m) continue
      const rest = lines[i].slice(m.index + m[0].length) + ' ' + (lines[i + 1] ?? '')
      const d = dateOn(rest)
      if (d) return d
    }
    return null
  }
  const sentOn = dateAfter(/\b(?:Sent|Envelope Originator|Created)\s*:?/i)
  const completedOn = dateAfter(/\b(?:Completed|Signed|Completion Date)\s*:?/i)

  const status = /\bStatus\s*:?\s*(Completed|Signed|Complete|Sent|Delivered|Declined|Voided|Expired|Pending|In progress|Waiting)\b/i.exec(flat)?.[1]?.toLowerCase()
  const notCompleted = !!status && !['completed', 'signed', 'complete'].includes(status)

  const head = flat.slice(0, 1500)
  // A phrase alone is not enough ("Certificate of Completion" is also what a finished-job form is called): it must come
  // with the tool's own name or an envelope id.
  const provider = providerOf(flat)
  const isCertificate = /certificate of completion|signature certificate|audit trail|summary of (?:the )?(?:signing|envelope)|envelope summary|document history/i.test(head) && (provider !== null || envelopeId !== null)

  return { provider, envelopeId, emails, names: Array.from(names).slice(0, 8), sentOn, completedOn, notCompleted, isCertificate }
}

/** The 36-character envelope id appearing in a FILE NAME, if any (DocuSign's own downloads are named after it). */
export function envelopeIdInName(name: string): string | null {
  const m = new RegExp(UUID).exec(name)
  return m ? m[0].toUpperCase() : null
}
