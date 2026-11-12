/**
 * Move signed documents — which files are ONE signed document (the agreement plus its certificate), and what the
 * envelope list and the PDFs' own text say about who signed and when. Pure.
 *
 * A group is what the owner sees as one row. Its customer is chosen once; every file in it follows. Files are paired by,
 * in order of trust: the same envelope id (from the PDF text, the file name, or the envelope list), the same folder in a
 * ZIP when that folder holds exactly one certificate, the same name apart from words like "Certificate of Completion".
 * Two files that name DIFFERENT envelope ids are never joined.
 */
import { envelopeIdInName } from './cert-text'
import type { EnvelopeRecord } from './envelope-index'
import type { SignedImportSource } from './files'

export type ItemFacts = {
  id: string
  sha256: string
  name: string
  dir: string
  /** The ZIP (or 'files') it came out of — folders only pair inside one origin. */
  origin: string
  /** Read from the PDF text (null until read). */
  isCertificate: boolean | null
  envelopeId: string | null
  emails: string[]
  names: string[]
  sentOn: string | null
  completedOn: string | null
  provider: SignedImportSource | null
  notCompleted: boolean
}

export type Group = {
  key: string
  itemIds: string[]
  agreementIds: string[]
  certificateIds: string[]
  envelopeId: string | null
  envelopeIdIsReal: boolean
  subject: string | null
  emails: string[]
  names: string[]
  fileNames: string[]
  sentOn: string | null
  completedOn: string | null
  provider: SignedImportSource | null
  /** Why this group must not be brought over as signed ("Declined in DocuSign"), else null. */
  notCompleted: boolean
}

const CERT_WORDS = /certificate|audit[\s_-]*trail|signature[\s_-]*summary|summary[\s_-]*page|completion|document[\s_-]*history|envelope[\s_-]*summary/i
const STEM_NOISE = /\b(certificate|of|completion|completed|audit|trail|summary|signed|executed|final|copy|signature|history|document|envelope)\b/g

export function nameLooksLikeCertificate(name: string): boolean {
  return CERT_WORDS.test(name)
}

export function stemOf(name: string): string {
  return name.toLowerCase().replace(/\.[a-z0-9]{1,5}$/, '').replace(STEM_NOISE, ' ').replace(/[^a-z0-9]+/g, '')
}

export function isCertificateItem(i: ItemFacts): boolean {
  return i.isCertificate === true || (i.isCertificate !== false && nameLooksLikeCertificate(i.name))
}

class Sets {
  private parent = new Map<string, string>()
  find(x: string): string {
    let p = this.parent.get(x) ?? x
    while (p !== (this.parent.get(p) ?? p)) p = this.parent.get(p) ?? p
    if (!this.parent.has(x)) this.parent.set(x, x)
    return p
  }
  union(a: string, b: string) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(rb, ra)
  }
}

export function groupItems(items: ItemFacts[], records: EnvelopeRecord[], ignoreEmails: ReadonlySet<string> = new Set()): Group[] {
  const sorted = [...items].sort((a, b) => a.sha256.localeCompare(b.sha256))
  const recById = new Map<string, EnvelopeRecord>()
  for (const r of records) if (r.envelopeId) recById.set(r.envelopeId.toLowerCase(), r)

  // 1. Each file's envelope id: its own text, its name, an id from the envelope list that appears in its name.
  const envOf = new Map<string, string | null>()
  for (const i of sorted) {
    let id = i.envelopeId ?? envelopeIdInName(i.name)
    if (!id) {
      const lower = i.name.toLowerCase()
      for (const key of Array.from(recById.keys())) {
        if (key.length >= 8 && lower.includes(key)) {
          id = recById.get(key)!.envelopeId
          break
        }
      }
    }
    envOf.set(i.id, id ? id.toLowerCase() : null)
  }

  const sets = new Sets()
  for (const i of sorted) sets.find(i.id)
  const byEnv = new Map<string, string>()
  for (const i of sorted) {
    const e = envOf.get(i.id)
    if (!e) continue
    const first = byEnv.get(e)
    if (first) sets.union(first, i.id)
    else byEnv.set(e, i.id)
  }
  const envsOfSet = (root: string) => new Set(sorted.filter((i) => sets.find(i.id) === root).map((i) => envOf.get(i.id)).filter((e): e is string => !!e))
  const mergeUnlessConflict = (a: string, b: string) => {
    const ra = sets.find(a)
    const rb = sets.find(b)
    if (ra === rb) return
    const ea = envsOfSet(ra)
    const eb = envsOfSet(rb)
    if (ea.size && eb.size) return // two different envelopes: never joined
    sets.union(a, b)
  }

  // 2. A ZIP folder with exactly one certificate and 1–5 agreements is one envelope.
  const byDir = new Map<string, ItemFacts[]>()
  for (const i of sorted) if (i.dir) byDir.set(`${i.origin}\u0000${i.dir}`, [...(byDir.get(`${i.origin}\u0000${i.dir}`) ?? []), i])
  for (const files of Array.from(byDir.values())) {
    const certs = files.filter(isCertificateItem)
    const agreements = files.filter((f) => !isCertificateItem(f))
    if (certs.length === 1 && agreements.length >= 1 && agreements.length <= 5) for (const a of agreements) mergeUnlessConflict(certs[0].id, a.id)
  }

  // 3. "Smith Contract.pdf" + "Smith Contract - Certificate of Completion.pdf" (same origin and folder).
  const agreementsByStem = new Map<string, ItemFacts[]>()
  for (const i of sorted) if (!isCertificateItem(i)) {
    const k = `${i.origin}\u0000${i.dir}\u0000${stemOf(i.name)}`
    agreementsByStem.set(k, [...(agreementsByStem.get(k) ?? []), i])
  }
  for (const c of sorted.filter(isCertificateItem)) {
    const stem = stemOf(c.name)
    if (!stem) continue
    const hits = agreementsByStem.get(`${c.origin}\u0000${c.dir}\u0000${stem}`) ?? []
    if (hits.length === 1) mergeUnlessConflict(c.id, hits[0].id)
  }

  // 4. Build the groups.
  const roots = new Map<string, ItemFacts[]>()
  for (const i of sorted) roots.set(sets.find(i.id), [...(roots.get(sets.find(i.id)) ?? []), i])
  const groups: Group[] = []
  for (const files of Array.from(roots.values())) {
    const agreements = files.filter((f) => !isCertificateItem(f))
    const certificates = files.filter(isCertificateItem)
    const env = files.map((f) => envOf.get(f.id)).find((e): e is string => !!e) ?? null
    const rec = env ? recById.get(env) ?? null : null
    // An envelope-list row found by subject = the file's name (when no id links them).
    const recBySubject = rec ?? (agreements[0] ? records.find((r) => r.subject && stemOf(r.subject) && stemOf(r.subject) === stemOf(agreements[0].name)) ?? null : null)
    const r = rec ?? recBySubject
    const emails = new Set<string>()
    const names = new Set<string>()
    for (const f of files) {
      f.emails.forEach((e) => emails.add(e))
      f.names.forEach((n) => names.add(n))
    }
    r?.signers.forEach((s) => {
      if (s.email) emails.add(s.email.toLowerCase())
      if (s.name) names.add(s.name)
    })
    for (const e of Array.from(emails)) if (ignoreEmails.has(e)) emails.delete(e)
    const sha16 = files[0].sha256.slice(0, 16)
    const realId = env ? (files.map((f) => f.envelopeId ?? envelopeIdInName(f.name)).find(Boolean) ?? r?.envelopeId ?? env) : null
    groups.push({
      key: realId ? `env:${env}` : `pair:${(agreements[0] ?? files[0]).sha256.slice(0, 16)}`,
      itemIds: files.map((f) => f.id),
      agreementIds: agreements.map((f) => f.id),
      certificateIds: certificates.map((f) => f.id),
      envelopeId: realId ?? `pair:${sha16}`,
      envelopeIdIsReal: !!realId,
      subject: r?.subject ?? null,
      emails: Array.from(emails).slice(0, 12),
      names: Array.from(names).slice(0, 12),
      fileNames: files.map((f) => f.name),
      sentOn: r?.sentOn ?? files.map((f) => f.sentOn).find(Boolean) ?? null,
      completedOn: r?.completedOn ?? files.map((f) => f.completedOn).find(Boolean) ?? null,
      provider: files.map((f) => f.provider).find(Boolean) ?? null,
      notCompleted: !!r?.notCompleted || files.some((f) => f.notCompleted),
    })
  }
  return groups.sort((a, b) => a.key.localeCompare(b.key))
}
