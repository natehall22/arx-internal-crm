/**
 * Move signed documents — the CSV a signing tool exports next to the PDFs (DocuSign's envelope / completed-documents
 * report, Dropbox Sign's and PandaDoc's document lists). Pure. Columns are found by header NAME from a list of spellings
 * (the Jobber import does the same); a column nobody recognises is ignored. UNVERIFIED against real exports — header
 * spellings are from the tools' documentation. A CSV with no recognisable id / email / name / subject column is refused
 * with a plain message instead of being read as noise.
 */
import { dateOn, emailsIn } from './cert-text'

export type EnvelopeRecord = {
  envelopeId: string | null
  subject: string | null
  signers: Array<{ name: string | null; email: string | null }>
  sentOn: string | null
  completedOn: string | null
  /** The CSV says this one was NOT completed (declined, voided, still out for signature). */
  notCompleted: boolean
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const ALIASES = {
  envelopeId: ['envelope id', 'envelope guid', 'envelopeid', 'document id', 'signature request id', 'request id', 'transaction id', 'id'],
  subject: ['subject', 'envelope subject', 'email subject', 'document name', 'document title', 'title', 'name', 'envelope name'],
  status: ['status', 'envelope status', 'document status', 'state'],
  sentOn: ['sent', 'sent date', 'sent on', 'date sent', 'created', 'created date', 'date created', 'created on'],
  completedOn: ['completed', 'completed date', 'completed on', 'date completed', 'completion date', 'completed time', 'signed date', 'date signed', 'finished'],
  signerName: ['recipient name', 'signer name', 'signer', 'recipient', 'recipients', 'signers', 'signer names', 'recipient names', 'customer name', 'client name', 'to name'],
  signerEmail: ['recipient email', 'signer email', 'email', 'recipient emails', 'signer emails', 'email address', 'recipient email address', 'to', 'to email', 'customer email', 'client email'],
} as const

type Field = keyof typeof ALIASES

function pickColumns(headers: string[]): Partial<Record<Field, number[]>> {
  const found: Partial<Record<Field, number[]>> = {}
  const heads = headers.map(norm)
  for (const field of Object.keys(ALIASES) as Field[]) {
    // Earlier aliases are the stronger spelling; each column is used for one field only.
    for (const alias of ALIASES[field]) {
      heads.forEach((h, i) => {
        if (h === alias && !Object.values(found).some((cols) => cols?.includes(i))) (found[field] ??= []).push(i)
      })
      if (found[field]?.length && field !== 'signerName' && field !== 'signerEmail') break
    }
  }
  return found
}

export type EnvelopeIndexRead = { recognized: boolean; records: EnvelopeRecord[]; message: string | null }

const COMPLETED = /^(completed|complete|signed|finished|done|executed)$/i
const NOT_COMPLETED = /^(sent|delivered|declined|voided|void|expired|waiting|pending|in ?progress|draft|canceled|cancelled|created|viewed|out for signature|awaiting)/i

export function readEnvelopeIndex(rows: string[][]): EnvelopeIndexRead {
  if (rows.length < 2) return { recognized: false, records: [], message: 'That file has no rows' }
  const cols = pickColumns(rows[0])
  const useful = [cols.envelopeId, cols.signerEmail, cols.signerName, cols.subject].filter((c) => c?.length).length
  if (!cols.envelopeId?.length && !cols.signerEmail?.length && !cols.signerName?.length) {
    return { recognized: false, records: [], message: 'This doesn’t look like a list of signed documents — it needs a column for the document id, or for who signed (name or email)' }
  }
  if (useful === 0) return { recognized: false, records: [], message: 'No usable columns found' }

  const cell = (r: string[], c?: number[]) => (c ?? []).map((i) => (r[i] ?? '').trim()).filter(Boolean)
  const records: EnvelopeRecord[] = []
  for (const r of rows.slice(1)) {
    const envelopeId = cell(r, cols.envelopeId)[0] ?? null
    // Emails sit in the email column, or inside a name cell ("Jane <jane@x.com>", "jane@x.com; bob@x.com").
    const emails = Array.from(new Set([...cell(r, cols.signerEmail), ...cell(r, cols.signerName)].flatMap((c) => emailsIn(c))))
    const nameCells = cell(r, cols.signerName).flatMap((c) => c.split(/\s*[;\n|]\s*/)).map((n) => n.replace(/<[^>]*>/g, '').trim()).filter((n) => n && !n.includes('@') && n.length <= 80)
    const status = cell(r, cols.status)[0] ?? ''
    const signers: EnvelopeRecord['signers'] = []
    const count = Math.max(emails.length, nameCells.length)
    for (let i = 0; i < count; i++) signers.push({ name: nameCells[i] ?? null, email: emails[i] ?? null })
    // A name cell with emails inside it ("Jane <jane@x.com>") is covered by emailsIn above; names without emails stay.
    if (!envelopeId && !signers.length) continue
    records.push({
      envelopeId: envelopeId && envelopeId.length <= 100 ? envelopeId : null,
      subject: cell(r, cols.subject)[0]?.slice(0, 200) ?? null,
      signers: signers.slice(0, 8),
      sentOn: dateOn(cell(r, cols.sentOn)[0] ?? ''),
      completedOn: dateOn(cell(r, cols.completedOn)[0] ?? ''),
      notCompleted: !!status && !COMPLETED.test(status.trim()) && NOT_COMPLETED.test(status.trim()),
    })
  }
  return records.length ? { recognized: true, records, message: null } : { recognized: false, records: [], message: 'No rows could be read from that file' }
}
