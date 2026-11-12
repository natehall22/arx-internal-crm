/**
 * Move signed documents — database side (server only, service-role client, everything through orgDb). Runs on the same
 * import tables the Jobber import uses (import_runs / import_run_files / import_run_items, source 'signed_docs'), and
 * the same claim + undo functions (SQL import_run_claim / import_undo_row via lib/jobber-import/db.ts). Steps:
 *   add      — the browser unzips (lib/signed-import/zip.ts), hashes each PDF and `registerFiles`: a file already in the
 *              company's documents (same SHA-256) or already in this run is skipped, anything else gets a one-time signed
 *              upload URL and goes straight to storage, then `confirmUploads` re-reads the stored bytes (PDF? same hash?).
 *   read     — `readStep`: the first pages' text of each PDF → envelope id, emails, dates (certificate-text.ts).
 *   match    — `matchStep`: pair certificates with agreements, ask the Jobber matchers which customer; stored on the items.
 *   review   — `reviewGroups` + `savePicks`: the owner's choices (a customer, "keep for later", "don't add").
 *   import   — `importBatch`: one `documents` row per file (signed_executed / supporting_attachment, protected, read-only).
 * Never created here: customers, jobs, contracts, change orders, sales, commissions, payroll. A document with no customer
 * is `documents.customer_id = NULL` and waits on the held list until an owner picks one (`assignHeld`).
 * Who: owners only (isSuperAdmin), checked by the routes.
 */
import { createHash, randomUUID } from 'crypto'

import type { SupabaseClient } from '@supabase/supabase-js'

import { parseCsv } from '@/lib/csv'
import { type CustomerIdentityRow } from '@/lib/customers'
import { signedUploadTokenForPath } from '@/lib/files/signed-upload'
import { FILES_BUCKET, buildImportedDocumentStoragePath, safeUploadFilename } from '@/lib/files/storage'
import { listRuns, loadRun, openRun, runProgress, startUndo, undoBatch, type Progress, type RunRow } from '@/lib/jobber-import/db'
import { ITEM_RANK } from '@/lib/jobber-import/plan'
import { fetchSupabaseAllPages, IN_CHUNK } from '@/lib/supabase-fetch-all-pages'
import { orgDb } from '@/lib/supabase/org-db'

import { readCertificateText } from './cert-text'
import { readEnvelopeIndex, type EnvelopeRecord } from './envelope-index'
import { MAX_CSV_BYTES, MAX_PDF_BYTES, MAX_RUN_PDFS, SHA256_RE, displayName, dirOf, isSignedImportSource, looksLikePdf, type SignedImportSource } from './files'
import { groupItems, isCertificateItem, type Group, type ItemFacts } from './group'
import { matchGroups, type GroupMatch } from './match'
import { extractPdfText } from './pdf-text'

export { startUndo, undoBatch }

export const SIGNED_NOT_READY = 'Move signed documents turns on once the database update for it is applied (migration 202611190010).'
const SOURCE = 'signed_docs' as const
const MAX_INDEX_ROWS = 20_000
const IMPORT_BATCH = 25
const READ_BUDGET_MS = 20_000
const MATCH_GROUPS_PER_STEP = 40
const UUID_RE = /^[0-9a-f-]{36}$/i

type Fail = { ok: false; status: number; error: string }
const fail = (status: number, error: string): Fail => ({ ok: false, status, error })

export type MatchView = GroupMatch
export type ItemPayload = {
  name: string
  dir: string
  origin: string
  size: number
  sha256: string
  documentId: string
  storagePath: string
  uploaded?: boolean
  read?: boolean
  isCertificate?: boolean | null
  envelopeId?: string | null
  emails?: string[]
  names?: string[]
  sentOn?: string | null
  completedOn?: string | null
  provider?: SignedImportSource | null
  notCompleted?: boolean
  // Set by the match step.
  matchStamp?: string
  group?: Omit<Group, 'itemIds' | 'agreementIds' | 'certificateIds' | 'fileNames'> & { itemIds?: string[]; title?: string }
  role?: 'agreement' | 'certificate'
  match?: GroupMatch
  note?: string
}
type ItemRow = { id: string; run_id: string; seq: number; source_id: string; label: string; status: string; action: string; payload: ItemPayload; error: string | null; target_id: string | null }

const ITEM_COLS = 'id, run_id, seq, source_id, label, status, action, payload, error, target_id'

// ---------------------------------------------------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------------------------------------------------

export const listSignedRuns = (admin: SupabaseClient, orgId: string) => listRuns(admin, orgId, SOURCE)
export const loadSignedRun = (admin: SupabaseClient, orgId: string, runId: string) => loadRun(admin, orgId, runId, SOURCE)
export const openSignedRun = (admin: SupabaseClient, orgId: string, userId: string) => openRun(admin, orgId, userId, SOURCE)
export const startSignedUndo = (admin: SupabaseClient, orgId: string, run: RunRow) => startUndo(admin, orgId, run, SOURCE)

async function loadItems(admin: SupabaseClient, orgId: string, runId: string): Promise<ItemRow[]> {
  return fetchSupabaseAllPages<ItemRow>((from, to) => orgDb(admin, orgId).from('import_run_items').select(ITEM_COLS).eq('run_id', runId).eq('kind', 'document').order('seq').range(from, to))
}

async function patchPayload(admin: SupabaseClient, orgId: string, item: Pick<ItemRow, 'id' | 'payload'>, patch: Partial<ItemPayload>, extra: Record<string, unknown> = {}) {
  const next = { ...item.payload, ...patch }
  const { error } = await orgDb(admin, orgId).from('import_run_items').update({ payload: next, ...extra }).eq('id', item.id)
  if (error) throw new Error(`signed import: could not save item: ${error.message}`)
  item.payload = next
}

const picksOf = (run: RunRow): Record<string, string> => {
  const p = (run.mapping as Record<string, unknown>)?.picks
  return p && typeof p === 'object' ? (p as Record<string, string>) : {}
}
const providerChoice = (run: RunRow): SignedImportSource | null => {
  const v = (run.mapping as Record<string, unknown>)?.provider
  const choice = v && typeof v === 'object' ? (v as Record<string, unknown>).value : null
  return isSignedImportSource(choice) ? choice : null
}

/** What the owner said the files came from (null = work it out from each file). Stored in run.mapping.provider.value. */
export async function setProvider(admin: SupabaseClient, orgId: string, run: RunRow, choice: unknown): Promise<{ ok: true } | Fail> {
  if (run.status !== 'draft') return fail(409, 'This import has already started')
  const value = isSignedImportSource(choice) && choice !== 'other' ? choice : ''
  const mapping = { ...(run.mapping as Record<string, unknown>), provider: { value } }
  const { error } = await orgDb(admin, orgId).from('import_runs').update({ mapping, updated_at: new Date().toISOString() }).eq('id', run.id).eq('status', 'draft')
  if (error) return fail(500, 'Could not save that')
  run.mapping = mapping as RunRow['mapping']
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------------------------------
// Add files
// ---------------------------------------------------------------------------------------------------------------------

export type RegisterInput = { name: string; dir?: string; origin?: string; size: number; sha256: string }
export type RegisterResult =
  | { sha256: string; state: 'upload'; itemId: string; documentId: string; storagePath: string; bucket: string; token: string }
  | { sha256: string; state: 'duplicate'; title: string | null }
  | { sha256: string; state: 'added' }
  | { sha256: string; state: 'refused'; reason: string }

/** Up to REGISTER_BATCH files the browser has unzipped and hashed. Nothing is stored until the browser uploads. */
export async function registerFiles(
  admin: SupabaseClient,
  orgId: string,
  run: RunRow,
  files: unknown,
  skipped: unknown
): Promise<{ ok: true; results: RegisterResult[] } | Fail> {
  if (run.status !== 'draft') return fail(409, 'This import has already started')
  const list = (Array.isArray(files) ? files : []).slice(0, 100) as Array<Record<string, unknown>>
  if (!list.length) return fail(400, 'No files')
  const db = orgDb(admin, orgId)

  const clean: Array<RegisterInput & { refused?: string }> = list.map((f) => {
    const sha256 = typeof f.sha256 === 'string' ? f.sha256.toLowerCase() : ''
    const name = typeof f.name === 'string' ? displayName(f.name) : ''
    const size = typeof f.size === 'number' && Number.isFinite(f.size) ? Math.floor(f.size) : 0
    const base = { name, size, sha256, dir: typeof f.dir === 'string' ? dirOf(`${f.dir}/x`) : '', origin: typeof f.origin === 'string' ? f.origin.slice(0, 200) : '' }
    if (!SHA256_RE.test(sha256)) return { ...base, refused: 'bad fingerprint' }
    if (!/\.pdf$/i.test(name)) return { ...base, refused: 'not a PDF' }
    if (size < 8 || size > MAX_PDF_BYTES) return { ...base, refused: `over ${Math.round(MAX_PDF_BYTES / 1024 / 1024)} MB` }
    return base
  })
  const shas = Array.from(new Set(clean.filter((c) => !c.refused).map((c) => c.sha256)))

  const existingDocs = new Map<string, string | null>()
  const existingItems = new Map<string, ItemRow>()
  for (let i = 0; i < shas.length; i += IN_CHUNK) {
    const part = shas.slice(i, i + IN_CHUNK)
    const [docs, items] = await Promise.all([
      db.from('documents').select('sha256, title').in('sha256', part).is('deleted_at', null),
      db.from('import_run_items').select(ITEM_COLS).eq('run_id', run.id).in('source_id', part.map((s) => `file:${s}`)),
    ])
    if (docs.error) return fail(503, SIGNED_NOT_READY)
    for (const d of (docs.data ?? []) as Array<{ sha256: string; title: string | null }>) existingDocs.set(d.sha256, d.title)
    for (const it of (items.data ?? []) as ItemRow[]) existingItems.set(it.source_id, it)
  }

  const { count } = await db.from('import_run_items').select('id', { count: 'exact', head: true }).eq('run_id', run.id)
  let total = count ?? 0
  const { data: last } = await db.from('import_run_items').select('seq').eq('run_id', run.id).order('seq', { ascending: false }).limit(1)
  let seq = Number((last as Array<{ seq: number }> | null)?.[0]?.seq ?? 0)

  const results: RegisterResult[] = []
  const seen = new Set<string>()
  const dupes: Record<string, { name: string; title: string | null }> = {}
  for (const f of clean) {
    if (f.refused) {
      results.push({ sha256: f.sha256, state: 'refused', reason: f.refused })
      continue
    }
    if (seen.has(f.sha256)) {
      results.push({ sha256: f.sha256, state: 'added' })
      continue
    }
    seen.add(f.sha256)
    if (existingDocs.has(f.sha256)) {
      results.push({ sha256: f.sha256, state: 'duplicate', title: existingDocs.get(f.sha256) ?? null })
      dupes[f.sha256] = { name: f.name.slice(0, 160), title: existingDocs.get(f.sha256) ?? null }
      continue
    }
    const had = existingItems.get(`file:${f.sha256}`)
    if (had && (had.payload.uploaded || had.status === 'skipped' || had.status === 'failed')) {
      if (had.status === 'failed') {
        // A file that failed its check is tried again from scratch.
        await db.from('import_run_items').delete().eq('id', had.id)
        existingItems.delete(`file:${f.sha256}`)
      } else {
        results.push({ sha256: f.sha256, state: 'added' })
        continue
      }
    }
    let item = existingItems.get(`file:${f.sha256}`)
    if (!item) {
      if (total >= MAX_RUN_PDFS) {
        results.push({ sha256: f.sha256, state: 'refused', reason: `this import already holds ${MAX_RUN_PDFS.toLocaleString()} files — import these first, then add more` })
        continue
      }
      const documentId = randomUUID()
      const payload: ItemPayload = {
        name: f.name,
        dir: f.dir ?? '',
        origin: f.origin ?? '',
        size: f.size,
        sha256: f.sha256,
        documentId,
        storagePath: buildImportedDocumentStoragePath({ orgId, documentId, filename: safeUploadFilename(f.name, 'document') }),
      }
      const { data, error } = await db
        .from('import_run_items')
        .insert({ run_id: run.id, kind: 'document', rank: ITEM_RANK.document, seq: ++seq, source_id: `file:${f.sha256}`, label: f.name.slice(0, 300), action: 'create', status: 'pending', payload })
        .select(ITEM_COLS)
        .single()
      if (error || !data) {
        results.push({ sha256: f.sha256, state: 'refused', reason: 'could not be saved — try again' })
        continue
      }
      item = data as ItemRow
      total += 1
    }
    const signed = await signedUploadTokenForPath(admin, FILES_BUCKET, item.payload.storagePath)
    if ('error' in signed) {
      results.push({ sha256: f.sha256, state: 'refused', reason: 'could not prepare the upload — try again' })
      continue
    }
    results.push({ sha256: f.sha256, state: 'upload', itemId: item.id, documentId: item.payload.documentId, storagePath: item.payload.storagePath, bucket: FILES_BUCKET, token: signed.token })
  }

  // What the ZIP held that was not a PDF (names + reasons) and which files were already on file are kept on the run for the
  // summary — capped, and keyed so adding the same ZIP again counts nothing twice.
  const hasSkipped = Array.isArray(skipped) && skipped.length > 0
  if (hasSkipped || Object.keys(dupes).length) {
    const summary = (run.summary ?? {}) as unknown as Record<string, unknown>
    const next: Record<string, unknown> = { ...summary }
    if (hasSkipped) {
      const prev = Array.isArray(summary.skipped) ? (summary.skipped as Array<{ name: string; reason: string }>) : []
      const add = (skipped as Array<Record<string, unknown>>).slice(0, 100).map((s) => ({ name: String(s.path ?? s.name ?? '').slice(0, 160), reason: String(s.reason ?? '').slice(0, 120) }))
      const have = new Set(prev.map((p) => `${p.name}|${p.reason}`))
      const fresh = add.filter((a) => !have.has(`${a.name}|${a.reason}`))
      next.skipped = [...prev, ...fresh].slice(0, 300)
      next.skippedCount = Number(summary.skippedCount ?? prev.length) + fresh.length
    }
    if (Object.keys(dupes).length) {
      const prev = (summary.dupes && typeof summary.dupes === 'object' ? summary.dupes : {}) as Record<string, unknown>
      const merged = { ...prev, ...dupes }
      next.dupes = Object.fromEntries(Object.entries(merged).slice(0, 500))
    }
    await db.from('import_runs').update({ summary: next }).eq('id', run.id).eq('status', 'draft')
    run.summary = next as never
  }
  return { ok: true, results }
}

/** The browser says it uploaded these items: read the stored bytes and check them (a PDF? the hash it announced?). */
export async function confirmUploads(admin: SupabaseClient, orgId: string, run: RunRow, itemIds: unknown): Promise<{ ok: true; results: Array<{ itemId: string; ok: boolean; error?: string }> } | Fail> {
  if (run.status !== 'draft') return fail(409, 'This import has already started')
  const ids = (Array.isArray(itemIds) ? itemIds : []).filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)).slice(0, 12)
  if (!ids.length) return fail(400, 'No files')
  const db = orgDb(admin, orgId)
  const { data } = await db.from('import_run_items').select(ITEM_COLS).eq('run_id', run.id).in('id', ids)
  const results: Array<{ itemId: string; ok: boolean; error?: string }> = []
  for (const item of (data ?? []) as ItemRow[]) {
    if (item.payload.uploaded) {
      results.push({ itemId: item.id, ok: true })
      continue
    }
    const bad = async (error: string) => {
      await admin.storage.from(FILES_BUCKET).remove([item.payload.storagePath])
      await db.from('import_run_items').update({ status: 'failed', error }).eq('id', item.id)
      results.push({ itemId: item.id, ok: false, error })
    }
    const bytes = await downloadBytes(admin, item.payload.storagePath)
    if (!bytes) {
      results.push({ itemId: item.id, ok: false, error: 'The upload did not arrive — try again' })
      continue
    }
    if (bytes.length > MAX_PDF_BYTES) { await bad('Over the size limit'); continue }
    if (!looksLikePdf(bytes)) { await bad('Not a PDF'); continue }
    if (createHash('sha256').update(bytes).digest('hex') !== item.payload.sha256) { await bad('The file changed while it was uploading — add it again'); continue }
    await patchPayload(admin, orgId, item, { uploaded: true, size: bytes.length })
    results.push({ itemId: item.id, ok: true })
  }
  return { ok: true, results }
}

async function downloadBytes(admin: SupabaseClient, path: string): Promise<Uint8Array | null> {
  try {
    const { data, error } = await admin.storage.from(FILES_BUCKET).download(path)
    if (error || !data || typeof (data as Blob).arrayBuffer !== 'function') return null
    return new Uint8Array(await (data as Blob).arrayBuffer())
  } catch {
    return null
  }
}

/** Drops files that never finished uploading (a closed tab), so the rest can go on. */
export async function dropUnfinished(admin: SupabaseClient, orgId: string, run: RunRow): Promise<{ ok: true; dropped: number } | Fail> {
  if (run.status !== 'draft') return fail(409, 'This import has already started')
  const items = (await loadItems(admin, orgId, run.id)).filter((i) => i.status === 'pending' && !i.payload.uploaded)
  if (items.length) {
    await admin.storage.from(FILES_BUCKET).remove(items.map((i) => i.payload.storagePath))
    for (let i = 0; i < items.length; i += IN_CHUNK) await orgDb(admin, orgId).from('import_run_items').delete().in('id', items.slice(i, i + IN_CHUNK).map((x) => x.id))
  }
  return { ok: true, dropped: items.length }
}

// ---------------------------------------------------------------------------------------------------------------------
// Envelope lists (CSV)
// ---------------------------------------------------------------------------------------------------------------------

export async function addEnvelopeIndex(admin: SupabaseClient, orgId: string, run: RunRow, name: string, text: string): Promise<{ ok: true; records: number } | Fail> {
  if (run.status !== 'draft') return fail(409, 'This import has already started')
  if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) return fail(413, 'That list is over 4 MB — split it')
  const rows = parseCsv(text)
  if (rows.length - 1 > MAX_INDEX_ROWS) return fail(413, `That list has more than ${MAX_INDEX_ROWS.toLocaleString()} rows — split it`)
  const read = readEnvelopeIndex(rows)
  if (!read.recognized) return fail(400, `${displayName(name)}: ${read.message ?? 'not a list of signed documents'}`)
  const { error } = await orgDb(admin, orgId).from('import_run_files').insert({
    run_id: run.id,
    name: displayName(name),
    kind: 'envelope_index',
    headers: rows[0].map((h) => h.trim()),
    rows: rows.slice(1),
    row_count: rows.length - 1,
    sha256: createHash('sha256').update(text).digest('hex'),
  })
  if (error) return error.code === '23505' ? { ok: true, records: read.records.length } : fail(500, 'Could not save that list')
  return { ok: true, records: read.records.length }
}

export async function removeEnvelopeIndex(admin: SupabaseClient, orgId: string, run: RunRow, fileId: string): Promise<{ ok: true } | Fail> {
  if (run.status !== 'draft') return fail(409, 'This import has already started')
  if (typeof fileId !== 'string' || !UUID_RE.test(fileId)) return fail(400, 'Which list?')
  await orgDb(admin, orgId).from('import_run_files').delete().eq('id', fileId).eq('run_id', run.id)
  return { ok: true }
}

export async function loadIndexFiles(admin: SupabaseClient, orgId: string, runId: string): Promise<Array<{ id: string; name: string; row_count: number }>> {
  const { data } = await orgDb(admin, orgId).from('import_run_files').select('id, name, row_count').eq('run_id', runId).eq('kind', 'envelope_index').order('created_at')
  return (data ?? []) as Array<{ id: string; name: string; row_count: number }>
}

async function loadIndexRecords(admin: SupabaseClient, orgId: string, runId: string): Promise<{ records: EnvelopeRecord[]; stamp: string }> {
  const { data } = await orgDb(admin, orgId).from('import_run_files').select('headers, rows, sha256').eq('run_id', runId).eq('kind', 'envelope_index').order('sha256')
  const files = (data ?? []) as Array<{ headers: string[]; rows: string[][]; sha256: string }>
  const records = files.flatMap((f) => readEnvelopeIndex([f.headers, ...f.rows]).records)
  return { records, stamp: files.map((f) => f.sha256).join(',') }
}

// ---------------------------------------------------------------------------------------------------------------------
// Read (text of each PDF)
// ---------------------------------------------------------------------------------------------------------------------

export type StepResult = { ok: true; done: boolean; at: number; of: number }

/** Reads as many uploaded-but-unread PDFs as fit in ~20 s. The screen calls again until `done`. */
export async function readStep(admin: SupabaseClient, orgId: string, run: RunRow): Promise<StepResult | Fail> {
  if (run.status !== 'draft') return fail(409, 'This import has already started')
  const items = (await loadItems(admin, orgId, run.id)).filter((i) => i.status === 'pending')
  const ready = items.filter((i) => i.payload.uploaded)
  const todo = ready.filter((i) => !i.payload.read)
  const started = Date.now()
  for (const item of todo) {
    if (Date.now() - started > READ_BUDGET_MS) break
    const bytes = await downloadBytes(admin, item.payload.storagePath)
    let patch: Partial<ItemPayload> = { read: true, isCertificate: null }
    if (bytes) {
      const certName = /certificate|audit|summary|completion/i.test(item.payload.name)
      const text = await extractPdfText(bytes, { maxPages: certName ? 6 : 3 })
      if (text) {
        const f = readCertificateText(text)
        patch = {
          read: true,
          isCertificate: f.isCertificate ? true : false,
          envelopeId: f.envelopeId,
          emails: f.emails,
          names: f.names,
          sentOn: f.sentOn,
          completedOn: f.completedOn,
          provider: f.provider,
          notCompleted: f.notCompleted,
        }
      }
    }
    await patchPayload(admin, orgId, item, patch)
  }
  const left = ready.filter((i) => !i.payload.read).length
  return { ok: true, done: left === 0, at: ready.length - left, of: ready.length }
}

// ---------------------------------------------------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------------------------------------------------

async function loadCustomerRows(admin: SupabaseClient, orgId: string): Promise<CustomerIdentityRow[]> {
  return fetchSupabaseAllPages<CustomerIdentityRow>((from, to) => orgDb(admin, orgId).from('customers').select('id, name, email_lower, phone_normalized, address_text, created_at').order('id').range(from, to))
}

/** The company's own addresses (staff sign these envelopes too): never a reason to pick a customer. */
async function loadOwnEmails(admin: SupabaseClient, orgId: string): Promise<Set<string>> {
  const out = new Set<string>()
  const [users, org] = await Promise.all([
    orgDb(admin, orgId).from('users').select('email').limit(2000),
    admin.from('orgs').select('email').eq('id', orgId).maybeSingle(),
  ])
  for (const u of (users.data ?? []) as Array<{ email: string | null }>) if (u.email) out.add(u.email.trim().toLowerCase())
  const oe = (org.data as { email?: string | null } | null)?.email
  if (oe) out.add(oe.trim().toLowerCase())
  return out
}

const factsOf = (i: ItemRow): ItemFacts => ({
  id: i.id,
  sha256: i.payload.sha256,
  name: i.payload.name,
  dir: i.payload.dir,
  origin: i.payload.origin,
  isCertificate: i.payload.isCertificate ?? null,
  envelopeId: i.payload.envelopeId ?? null,
  emails: i.payload.emails ?? [],
  names: i.payload.names ?? [],
  sentOn: i.payload.sentOn ?? null,
  completedOn: i.payload.completedOn ?? null,
  provider: i.payload.provider ?? null,
  notCompleted: i.payload.notCompleted === true,
})

/** Changes whenever the set of files or envelope lists changes: a match made for another set is not trusted. */
function stampFor(items: ItemRow[], indexStamp: string): string {
  return createHash('sha256').update(items.map((i) => i.payload.sha256).sort().join(',') + '|' + indexStamp).digest('hex').slice(0, 16)
}

export async function matchStep(admin: SupabaseClient, orgId: string, run: RunRow, at = 0): Promise<StepResult | Fail> {
  if (run.status !== 'draft') return fail(409, 'This import has already started')
  const items = (await loadItems(admin, orgId, run.id)).filter((i) => i.status === 'pending' && i.payload.uploaded && i.payload.read)
  const { records, stamp: indexStamp } = await loadIndexRecords(admin, orgId, run.id)
  const stamp = stampFor(items, indexStamp)
  const ownEmails = await loadOwnEmails(admin, orgId)
  const chosenProvider = providerChoice(run)
  const groups = groupItems(items.map(factsOf), records, ownEmails)
  const slice = groups.slice(at, at + MATCH_GROUPS_PER_STEP)
  if (slice.length) {
    const matches = matchGroups(slice, await loadCustomerRows(admin, orgId))
    const byId = new Map(items.map((i) => [i.id, i]))
    for (const g of slice) {
      const { itemIds, agreementIds, certificateIds, fileNames, ...rest } = g
      void fileNames
      const firstName = byId.get(agreementIds[0] ?? itemIds[0])!.payload.name
      const title = (g.subject || firstName.replace(/\.pdf$/i, '')).slice(0, 160)
      for (const id of itemIds) {
        const item = byId.get(id)!
        await patchPayload(admin, orgId, item, {
          matchStamp: stamp,
          group: { ...rest, title, provider: chosenProvider ?? rest.provider ?? null, itemIds },
          role: certificateIds.includes(id) ? 'certificate' : agreementIds.includes(id) ? 'agreement' : isCertificateItem(factsOf(item)) ? 'certificate' : 'agreement',
          match: matches.get(g.key),
        })
      }
    }
  }
  const next = at + slice.length
  return { ok: true, done: next >= groups.length, at: Math.min(next, groups.length), of: groups.length }
}

// ---------------------------------------------------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------------------------------------------------

export type ReviewGroup = {
  key: string
  title: string
  fileNames: string[]
  certificates: number
  completedOn: string | null
  provider: SignedImportSource | null
  notCompleted: boolean
  match: GroupMatch
  /** '' = keep for later, '-' = don't add, an id = that customer. Absent = the match is used as it stands. */
  pick: string | null
  signers: string[]
}

export async function reviewGroups(admin: SupabaseClient, orgId: string, run: RunRow): Promise<{ groups: ReviewGroup[]; ready: boolean; unfinished: number; unread: number; duplicates: Array<{ name: string; title: string | null }> }> {
  const all = await loadItems(admin, orgId, run.id)
  const live = all.filter((i) => i.status === 'pending')
  const unfinished = live.filter((i) => !i.payload.uploaded).length
  const unread = live.filter((i) => i.payload.uploaded && !i.payload.read).length
  const { stamp: indexStamp } = await loadIndexRecords(admin, orgId, run.id)
  const stamp = stampFor(live.filter((i) => i.payload.uploaded && i.payload.read), indexStamp)
  const matched = live.filter((i) => i.payload.uploaded && i.payload.read && i.payload.matchStamp === stamp && i.payload.group)
  const picks = picksOf(run)
  const byKey = new Map<string, ItemRow[]>()
  for (const i of matched) byKey.set(i.payload.group!.key, [...(byKey.get(i.payload.group!.key) ?? []), i])
  const groups: ReviewGroup[] = []
  for (const [key, rows] of Array.from(byKey)) {
    const g = rows[0].payload.group!
    const agreements = rows.filter((r) => r.payload.role !== 'certificate')
    groups.push({
      key,
      title: g.title ?? (g.subject || (agreements[0] ?? rows[0]).payload.name.replace(/\.pdf$/i, '')).slice(0, 160),
      fileNames: rows.map((r) => r.payload.name),
      certificates: rows.length - agreements.length,
      completedOn: g.completedOn ?? null,
      provider: g.provider ?? null,
      notCompleted: g.notCompleted === true,
      match: rows[0].payload.match ?? { customerId: null, how: null, candidates: [] },
      pick: key in picks ? picks[key] : null,
      signers: [...(g.names ?? []), ...(g.emails ?? [])].slice(0, 4),
    })
  }
  const rank = (g: ReviewGroup) => (g.notCompleted ? 3 : g.match.customerId ? (g.match.how === 'close' ? 1 : 2) : 0)
  groups.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title))
  const matchedCount = matched.length
  const dupes = ((run.summary ?? {}) as unknown as { dupes?: Record<string, { name: string; title: string | null }> }).dupes ?? {}
  const duplicates = Object.values(dupes).slice(0, 100)
  return { groups, ready: unfinished === 0 && unread === 0 && matchedCount === live.length && live.length > 0, unfinished, unread, duplicates }
}

export async function savePicks(admin: SupabaseClient, orgId: string, run: RunRow, picks: unknown): Promise<{ ok: true } | Fail> {
  if (run.status !== 'draft') return fail(409, 'This import has already started')
  if (!picks || typeof picks !== 'object' || Array.isArray(picks)) return fail(400, 'No choices')
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(picks as Record<string, unknown>).slice(0, MAX_RUN_PDFS)) {
    if (typeof v !== 'string' || !/^(env:|pair:)[A-Za-z0-9:-]{1,120}$/.test(k)) continue
    if (v === '' || v === '-' || UUID_RE.test(v)) clean[k] = v
  }
  const ids = Array.from(new Set(Object.values(clean).filter((v) => UUID_RE.test(v))))
  const known = await existingCustomerIds(admin, orgId, ids)
  for (const [k, v] of Object.entries(clean)) if (UUID_RE.test(v) && !known.has(v)) return fail(400, `One of the customers you picked is not in your company (${k.slice(0, 20)}…)`)
  const mapping = { ...(run.mapping as Record<string, unknown>), picks: clean }
  const { error } = await orgDb(admin, orgId).from('import_runs').update({ mapping, updated_at: new Date().toISOString() }).eq('id', run.id).eq('status', 'draft')
  if (error) return fail(500, 'Could not save your choices')
  run.mapping = mapping as RunRow['mapping']
  return { ok: true }
}

async function existingCustomerIds(admin: SupabaseClient, orgId: string, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data } = await orgDb(admin, orgId).from('customers').select('id').in('id', ids.slice(i, i + IN_CHUNK))
    for (const r of (data ?? []) as Array<{ id: string }>) out.add(r.id)
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------------------------------

/** The customer a group's files go to: the owner's pick, else the match as it stands, else nobody yet (kept for later). */
export function customerFor(item: Pick<ItemRow, 'payload'>, picks: Record<string, string>): string | null {
  const key = item.payload.group?.key
  if (!key) return null
  if (key in picks) return picks[key] && picks[key] !== '-' ? picks[key] : null
  return item.payload.match?.customerId ?? null
}

export async function startSignedImport(admin: SupabaseClient, orgId: string, run: RunRow): Promise<{ ok: true } | Fail> {
  if (run.status === 'importing') return { ok: true }
  if (run.status !== 'draft') return fail(409, 'This import has already run')
  const review = await reviewGroups(admin, orgId, run)
  if (review.unfinished) return fail(409, `${review.unfinished} file${review.unfinished === 1 ? '' : 's'} didn’t finish uploading — add them again, or leave them out`)
  if (!review.ready) return fail(409, 'Match the documents first')
  const items = (await loadItems(admin, orgId, run.id)).filter((i) => i.status === 'pending')
  const picks = picksOf(run)
  const db = orgDb(admin, orgId)
  const leaveOut = items.filter((i) => picks[i.payload.group?.key ?? ''] === '-' || i.payload.group?.notCompleted === true)
  for (const i of leaveOut) {
    await db.from('import_run_items').update({ status: 'skipped', action: 'skip', error: i.payload.group?.notCompleted ? 'Not finished signing — left out' : 'Left out' }).eq('id', i.id)
  }
  if (leaveOut.length) await admin.storage.from(FILES_BUCKET).remove(leaveOut.map((i) => i.payload.storagePath))
  if (leaveOut.length === items.length) return fail(400, 'Nothing to bring over')
  const { data } = await db.from('import_runs').update({ status: 'importing', started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', run.id).eq('status', 'draft').select('id')
  return (data ?? []).length ? { ok: true } : fail(409, 'This import changed — reload')
}

type Outcome = { status: 'done' | 'failed' | 'skipped'; target_table?: string; target_id?: string; applied?: Record<string, unknown>; error?: string }

function titleFor(item: ItemRow, agreementTitle: string): string {
  return (item.payload.role === 'certificate' ? `Certificate of completion — ${agreementTitle}` : agreementTitle).slice(0, 200)
}

/** One batch (≤ 25). Call again until `finished`. Safe to call twice at once and after a cut-off (ids are fixed, inserts idempotent). */
export async function importBatch(admin: SupabaseClient, orgId: string, userId: string, run: RunRow): Promise<{ ok: true; progress: Progress; finished: boolean } | Fail> {
  if (run.status !== 'importing') return fail(409, run.status === 'draft' ? 'Press Import first' : 'This import is not running')
  const { data: claimed, error } = await admin.rpc('import_run_claim', { p_org: orgId, p_run: run.id, p_limit: IMPORT_BATCH })
  if (error) return fail(500, 'Could not continue the import')
  const items = (claimed ?? []) as ItemRow[]
  const db = orgDb(admin, orgId)
  const picks = picksOf(run)
  const customerIds = Array.from(new Set(items.map((i) => customerFor(i, picks)).filter((x): x is string => !!x)))
  const known = await existingCustomerIds(admin, orgId, customerIds)
  const oneProperty = new Map<string, string>()
  if (customerIds.length) {
    const { data: props } = await db.from('properties').select('id, customer_id').in('customer_id', customerIds)
    const per = new Map<string, string[]>()
    for (const p of (props ?? []) as Array<{ id: string; customer_id: string }>) per.set(p.customer_id, [...(per.get(p.customer_id) ?? []), p.id])
    for (const [c, ids] of Array.from(per)) if (ids.length === 1) oneProperty.set(c, ids[0])
  }
  const chosenProvider = providerChoice(run)

  for (const item of items) {
    let out: Outcome
    try {
      const customerId = customerFor(item, picks)
      if (customerId && !known.has(customerId)) {
        out = { status: 'failed', error: 'That customer no longer exists — pick another and import again' }
      } else {
        const g = item.payload.group!
        const agreementTitle = (g.title ?? g.subject ?? item.payload.name.replace(/\.pdf$/i, '')).slice(0, 160)
        const isCert = item.payload.role === 'certificate'
        const source: SignedImportSource = chosenProvider ?? g.provider ?? item.payload.provider ?? 'other'
        const row = {
          id: item.payload.documentId,
          customer_id: customerId,
          job_id: null,
          linked_record_type: null,
          linked_record_id: null,
          document_role: isCert ? 'supporting_attachment' : 'signed_executed',
          storage_path: item.payload.storagePath,
          filename: safeUploadFilename(item.payload.name, 'document'),
          file_size: item.payload.size,
          mime_type: 'application/pdf',
          category: isCert ? 'misc' : 'contract',
          title: titleFor(item, agreementTitle),
          description: null,
          status: 'active',
          is_protected: true,
          version: 1,
          uploaded_by: userId,
          sha256: item.payload.sha256,
          import_source: source,
          import_envelope_id: g.envelopeId ?? null,
          import_meta: { subject: g.subject ?? null, signers: (g.names ?? []).slice(0, 8), emails: (g.emails ?? []).slice(0, 12), sentOn: g.sentOn ?? null, completedOn: g.completedOn ?? null, envelopeIdIsReal: g.envelopeIdIsReal === true, role: item.payload.role ?? 'agreement', originalName: item.payload.name },
          ...(customerId && oneProperty.get(customerId) ? { property_id: oneProperty.get(customerId) } : {}),
        }
        const ins = await db.from('documents').insert(row).select('id').single()
        if (ins.error) {
          if (ins.error.code === '23505') {
            // Same id = this item already ran (cut off before it was marked done). Same hash = someone brought it over meanwhile.
            const { data: mine } = await db.from('documents').select('id, sha256').eq('id', item.payload.documentId).maybeSingle()
            if (mine && (mine as { sha256: string }).sha256 === item.payload.sha256) out = { status: 'done', target_table: 'documents', target_id: item.payload.documentId, applied: { customer_id: customerId, deleted_at: null } }
            else {
              await admin.storage.from(FILES_BUCKET).remove([item.payload.storagePath])
              out = { status: 'skipped', error: 'Already in your files' }
            }
          } else {
            out = { status: 'failed', error: (ins.error.message ?? 'Could not save').slice(0, 300) }
          }
        } else {
          out = { status: 'done', target_table: 'documents', target_id: item.payload.documentId, applied: { customer_id: customerId, deleted_at: null } }
        }
      }
    } catch (e) {
      out = { status: 'failed', error: e instanceof Error ? e.message : String(e) }
    }
    await db
      .from('import_run_items')
      .update({ status: out.status, ...(out.status === 'skipped' ? { action: 'skip' } : {}), target_table: out.target_table ?? null, target_id: out.target_id ?? null, applied: out.applied ?? null, error: out.error ? out.error.slice(0, 500) : null, done_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('status', 'working')
  }
  const progress = await runProgress(admin, orgId, run.id)
  const finished = progress.pending === 0
  if (finished) await db.from('import_runs').update({ status: 'done', finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', run.id).eq('status', 'importing')
  return { ok: true, progress, finished }
}

export type SignedSummary = { added: number; certificates: number; waiting: number; /** files that were already in the company's documents (found at the door or at import) */ duplicates: number; leftOut: number; failed: Array<{ name: string; error: string }>; notPdf: Array<{ name: string; reason: string }>; notPdfCount: number }

export async function signedSummary(admin: SupabaseClient, orgId: string, run: RunRow): Promise<SignedSummary> {
  const items = await loadItems(admin, orgId, run.id)
  const s: SignedSummary = { added: 0, certificates: 0, waiting: 0, duplicates: 0, leftOut: 0, failed: [], notPdf: [], notPdfCount: 0 }
  const picks = picksOf(run)
  for (const i of items) {
    if (i.status === 'done') {
      if (i.payload.role === 'certificate') s.certificates += 1
      else s.added += 1
      const hasCustomer = customerFor(i, picks)
      if (!hasCustomer && i.payload.role !== 'certificate') s.waiting += 1
    } else if (i.status === 'skipped') {
      if (i.action === 'skip' && /Already in your files/.test(i.error ?? '')) s.duplicates += 1
      else s.leftOut += 1
    } else if (i.status === 'failed') s.failed.push({ name: i.payload.name, error: i.error ?? 'Could not be saved' })
  }
  const skipped = ((run.summary ?? {}) as unknown as Record<string, unknown>)
  s.duplicates += Object.keys((skipped.dupes && typeof skipped.dupes === 'object' ? skipped.dupes : {}) as Record<string, unknown>).length
  s.notPdf = (Array.isArray(skipped.skipped) ? skipped.skipped : []).slice(0, 50) as SignedSummary['notPdf']
  s.notPdfCount = Number(skipped.skippedCount ?? s.notPdf.length)
  s.failed = s.failed.slice(0, 50)
  return s
}

export async function discardSignedRun(admin: SupabaseClient, orgId: string, run: RunRow): Promise<{ ok: true } | Fail> {
  if (run.status !== 'draft') return fail(409, 'Only an import that hasn’t started can be thrown away')
  const db = orgDb(admin, orgId)
  const items = await loadItems(admin, orgId, run.id)
  const paths = items.filter((i) => i.payload.uploaded || i.status === 'pending').map((i) => i.payload.storagePath)
  for (let i = 0; i < paths.length; i += 100) await admin.storage.from(FILES_BUCKET).remove(paths.slice(i, i + 100))
  await db.from('import_run_items').delete().eq('run_id', run.id)
  await db.from('import_run_files').delete().eq('run_id', run.id)
  await db.from('import_runs').update({ status: 'discarded', mapping: {}, summary: null }).eq('id', run.id).eq('status', 'draft')
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------------------------------
// Waiting for a customer
// ---------------------------------------------------------------------------------------------------------------------

export type HeldGroup = { key: string; title: string; documentIds: string[]; fileNames: string[]; completedOn: string | null; source: string | null; signers: string[]; match: GroupMatch }

const HELD_COLS = 'id, title, filename, import_source, import_envelope_id, import_meta, created_at'

/** Imported documents with no customer yet, grouped as they came in, with the best customer the matchers can find now. */
export async function listHeld(admin: SupabaseClient, orgId: string): Promise<{ ready: boolean; groups: HeldGroup[]; customers: Array<{ id: string; name: string }> }> {
  const { data, error } = await orgDb(admin, orgId).from('documents').select(HELD_COLS).not('import_source', 'is', null).is('customer_id', null).is('deleted_at', null).order('created_at', { ascending: false }).limit(1000)
  if (error) return { ready: false, groups: [], customers: [] }
  const rows = (data ?? []) as Array<{ id: string; title: string | null; filename: string; import_source: string | null; import_envelope_id: string | null; import_meta: Record<string, unknown> | null }>
  if (!rows.length) return { ready: true, groups: [], customers: [] }
  const byKey = new Map<string, typeof rows>()
  for (const r of rows) byKey.set(r.import_envelope_id ?? `doc:${r.id}`, [...(byKey.get(r.import_envelope_id ?? `doc:${r.id}`) ?? []), r])
  const customers = await loadCustomerRows(admin, orgId)
  const asGroups: Group[] = Array.from(byKey).map(([key, rs]) => {
    const meta = (rs[0].import_meta ?? {}) as Record<string, unknown>
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return {
      key,
      itemIds: rs.map((r) => r.id),
      agreementIds: rs.map((r) => r.id),
      certificateIds: [],
      envelopeId: rs[0].import_envelope_id,
      envelopeIdIsReal: meta.envelopeIdIsReal === true,
      subject: typeof meta.subject === 'string' ? meta.subject : null,
      emails: strs(meta.emails),
      names: strs(meta.signers),
      fileNames: rs.map((r) => String(((r.import_meta ?? {}) as Record<string, unknown>).originalName ?? r.filename)),
      sentOn: null,
      completedOn: typeof meta.completedOn === 'string' ? meta.completedOn : null,
      provider: null,
      notCompleted: false,
    }
  })
  const matches = matchGroups(asGroups, customers)
  const groups: HeldGroup[] = asGroups.map((g) => ({
    key: g.key,
    title: (g.subject ?? byKey.get(g.key)![0].title ?? 'Signed document').slice(0, 160),
    documentIds: g.itemIds,
    fileNames: g.fileNames,
    completedOn: g.completedOn,
    source: byKey.get(g.key)![0].import_source,
    signers: [...g.names, ...g.emails].slice(0, 4),
    match: matches.get(g.key) ?? { customerId: null, how: null, candidates: [] },
  }))
  return { ready: true, groups, customers: customers.filter((c) => c.name).map((c) => ({ id: c.id, name: String(c.name) })).sort((a, b) => a.name.localeCompare(b.name)) }
}

/** The owner picked a customer for held documents. Only documents still waiting move; a document with a customer is never re-homed here. */
export async function assignHeld(admin: SupabaseClient, orgId: string, assignments: unknown): Promise<{ ok: true; assigned: number } | Fail> {
  const list = (Array.isArray(assignments) ? assignments : []).slice(0, 200) as Array<Record<string, unknown>>
  if (!list.length) return fail(400, 'Nothing to add')
  const clean = list
    .map((a) => ({ customerId: typeof a.customerId === 'string' ? a.customerId : '', ids: (Array.isArray(a.documentIds) ? a.documentIds : []).filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)).slice(0, 20) }))
    .filter((a) => UUID_RE.test(a.customerId) && a.ids.length)
  if (!clean.length) return fail(400, 'Pick a customer first')
  const known = await existingCustomerIds(admin, orgId, Array.from(new Set(clean.map((a) => a.customerId))))
  if (clean.some((a) => !known.has(a.customerId))) return fail(400, 'That customer is not in your company')
  const db = orgDb(admin, orgId)
  let assigned = 0
  for (const a of clean) {
    const { data: props } = await db.from('properties').select('id').eq('customer_id', a.customerId).limit(2)
    const only = ((props ?? []) as Array<{ id: string }>).length === 1 ? (props as Array<{ id: string }>)[0].id : null
    const { data, error } = await db
      .from('documents')
      .update({ customer_id: a.customerId, ...(only ? { property_id: only } : {}) })
      .in('id', a.ids)
      .is('customer_id', null)
      .is('job_id', null)
      .is('deleted_at', null)
      .not('import_source', 'is', null)
      .select('id')
    if (error) return fail(500, 'Could not add those documents')
    assigned += (data ?? []).length
  }
  return { ok: true, assigned }
}
