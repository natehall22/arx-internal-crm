/** @jest-environment node */
/**
 * Move signed documents end to end on the in-memory database: add (register → upload → confirm) → read → match → picks →
 * import → summary → undo, plus duplicates, cut-offs, other companies and the held list. The SQL functions are stood in for
 * here; their real rules run in supabase/tests/run-signed-documents-import.sh (when run against a local Postgres).
 */
import { createHash } from 'node:crypto'

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { openRun } from '@/lib/jobber-import/db'
import {
  addEnvelopeIndex,
  assignHeld,
  confirmUploads,
  customerFor,
  discardSignedRun,
  dropUnfinished,
  importBatch,
  listHeld,
  loadSignedRun,
  matchStep,
  openSignedRun,
  readStep,
  registerFiles,
  reviewGroups,
  savePicks,
  setProvider,
  signedSummary,
  startSignedImport,
  startSignedUndo,
  undoBatch,
  type RegisterResult,
} from '@/lib/signed-import/db'

// The PDF "text" in this test is simply the file's own body (what a real extractor would pull out of a certificate).
jest.mock('@/lib/signed-import/pdf-text', () => ({ extractPdfText: async (b: Uint8Array) => Buffer.from(b).toString('latin1') }))

type Row = Record<string, unknown>
const ORG = '00000000-0000-4000-8000-0000000000a1'
const OTHER_ORG = '00000000-0000-4000-8000-0000000000b2'
const USER = '00000000-0000-4000-8000-0000000000c1'
const C_JANE = '00000000-0000-4000-8000-00000000d001'
const C_BOB = '00000000-0000-4000-8000-00000000d002'
const C_ANN = '00000000-0000-4000-8000-00000000d003'
const C_OTHER = '00000000-0000-4000-8000-00000000d0ff'
const P_JANE = '00000000-0000-4000-8000-00000000e001'

const pdf = (body: string) => Buffer.from(`%PDF-1.4\n${body}\n%%EOF`, 'latin1')
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

const ENV = '1A2B3C4D-1111-2222-3333-444455556666'
const FILES = {
  janeAgreement: { name: 'Jane Smith Roof.pdf', dir: 'Envelope 1', bytes: pdf(`DocuSign Envelope ID: ${ENV}\nRoof replacement agreement`) },
  janeCert: { name: 'Certificate.pdf', dir: 'Envelope 1', bytes: pdf(`Certificate Of Completion\nEnvelope Id: ${ENV}\nStatus: Completed\nCompleted: 3/6/2024 9:12 AM\nJane Smith\njane@example.com\nPowered by DocuSign`) },
  bob: { name: 'Bob Lee - Gutters.pdf', dir: '', bytes: pdf('Gutter agreement signed by hand') },
  mystery: { name: 'Zed Zero.pdf', dir: '', bytes: pdf('Somebody nobody knows') },
  declined: { name: 'Declined thing.pdf', dir: 'Envelope 3', bytes: pdf('Certificate Of Completion\nEnvelope Id: 9F9F9F9F-1111-2222-3333-444455556666\nStatus: Declined\nPowered by DocuSign') },
  already: { name: 'Already here.pdf', dir: '', bytes: pdf('This one is in the company files already') },
}

function world(extra: Record<string, Row[]> = {}) {
  const storage = new Map<string, Buffer>()
  const removed: string[] = []
  const db = createFakeDb(
    {
      orgs: [{ id: ORG, email: 'info@ours.test' }, { id: OTHER_ORG, email: null }],
      users: [{ id: USER, org_id: ORG, email: 'boss@ours.test' }],
      customers: [
        { id: C_JANE, org_id: ORG, name: 'Jane Smith', email_lower: 'jane@example.com', phone_normalized: null, address_text: null, created_at: '2025-01-01T00:00:00Z' },
        { id: C_BOB, org_id: ORG, name: 'Bob Lee', email_lower: 'bob@example.com', phone_normalized: null, address_text: null, created_at: '2025-01-01T00:00:00Z' },
        { id: C_ANN, org_id: ORG, name: 'Ann Cole', email_lower: null, phone_normalized: null, address_text: null, created_at: '2025-01-01T00:00:00Z' },
        { id: C_OTHER, org_id: OTHER_ORG, name: 'Their Customer', email_lower: 'jane@example.com', phone_normalized: null, address_text: null, created_at: '2025-01-01T00:00:00Z' },
      ],
      properties: [{ id: P_JANE, org_id: ORG, customer_id: C_JANE }, { id: 'p-bob-1', org_id: ORG, customer_id: C_BOB }, { id: 'p-bob-2', org_id: ORG, customer_id: C_BOB }],
      documents: [{ id: 'doc-existing', org_id: ORG, customer_id: C_ANN, title: 'Old contract', sha256: sha(FILES.already.bytes), deleted_at: null }],
      import_runs: [],
      import_run_files: [],
      import_run_items: [],
      ...extra,
    },
    {
      // The unique indexes the migrations create (documents' one is partial — live rows only — which no test here needs).
      unique: { import_run_files: [['run_id', 'sha256']], import_run_items: [['run_id', 'kind', 'source_id']], documents: [['org_id', 'sha256']] },
      idFactory: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` })(),
      rpc: {
        import_run_claim: (a, t) => {
          const mine = t.import_run_items.filter((i) => i.org_id === a.p_org && i.run_id === a.p_run)
          const take = mine.filter((i) => i.status === 'pending').slice(0, Number(a.p_limit))
          for (const i of take) Object.assign(i, { status: 'working', claimed_at: new Date().toISOString() })
          return take.map((i) => ({ ...i }))
        },
        import_undo_row: (a, t) => {
          const row = (t[a.p_table as string] ?? []).find((r) => r.id === a.p_id && r.org_id === a.p_org)
          if (!row || row.deleted_at) return 'gone'
          for (const [k, v] of Object.entries((a.p_applied as Row) ?? {})) if ((row[k] ?? null) !== (v ?? null)) return 'changed'
          row.deleted_at = new Date().toISOString()
          return 'deleted'
        },
      },
    }
  )
  const bucket = () => ({
    createSignedUploadUrl: async (path: string) => ({ data: { token: `tok:${path}`, path }, error: null }),
    download: async (path: string) => (storage.has(path) ? { data: new Blob([new Uint8Array(storage.get(path)!)]), error: null } : { data: null, error: { message: 'not found' } }),
    remove: async (paths: string[]) => { removed.push(...paths); for (const p of paths) storage.delete(p); return { data: [], error: null } },
  })
  const client = Object.assign({}, db.client, { storage: { from: bucket } }) as never
  return { db, client, storage, removed }
}
type World = ReturnType<typeof world>

const input = (f: { name: string; dir: string; bytes: Buffer }) => ({ name: f.name, dir: f.dir, origin: 'export.zip', size: f.bytes.length, sha256: sha(f.bytes) })

async function openDraft(w: World) {
  const opened = await openSignedRun(w.client, ORG, USER)
  if (!opened.ok) throw new Error(opened.error)
  return opened.run
}

/** What the browser does: register, then upload each requested file straight to storage, then confirm. */
async function addFiles(w: World, run: Awaited<ReturnType<typeof openDraft>>, files: Array<{ name: string; dir: string; bytes: Buffer }>, org = ORG) {
  const reg = await registerFiles(w.client, org, run, files.map(input), undefined)
  if (!reg.ok) throw new Error(reg.error)
  const byName = new Map(files.map((f) => [sha(f.bytes), f]))
  const todo = reg.results.filter((r): r is Extract<RegisterResult, { state: 'upload' }> => r.state === 'upload')
  for (const r of todo) w.storage.set(r.storagePath, byName.get(r.sha256)!.bytes)
  const conf = todo.length ? await confirmUploads(w.client, org, run, todo.map((t) => t.itemId)) : null
  return { results: reg.results, confirm: conf && conf.ok ? conf.results : [] }
}

async function readAndMatch(w: World, run: Awaited<ReturnType<typeof openDraft>>, org = ORG) {
  for (let i = 0; i < 5; i++) {
    const r = await readStep(w.client, org, run)
    if (r.ok && r.done) break
  }
  let at = 0
  for (let i = 0; i < 5; i++) {
    const m = await matchStep(w.client, org, run, at)
    if (!m.ok) throw new Error(m.error)
    if (m.done) break
    at = m.at
  }
}

const COMPANY_WRITES_ALLOWED = new Set(['import_runs', 'import_run_files', 'import_run_items', 'documents'])

describe('Move signed documents', () => {
  test('add → read → match → review → import: documents land signed, protected, linked; certificate attached; duplicates and unfinished signings left out', async () => {
    const w = world()
    const run = await openDraft(w)
    const added = await addFiles(w, run, Object.values(FILES))
    expect(added.results.map((r) => r.state)).toEqual(['upload', 'upload', 'upload', 'upload', 'upload', 'duplicate'])
    expect(added.confirm.every((c) => c.ok)).toBe(true)

    await readAndMatch(w, run)
    const review = await reviewGroups(w.client, ORG, run)
    expect(review).toMatchObject({ ready: true, unfinished: 0, unread: 0 })
    const byTitle = Object.fromEntries(review.groups.map((g) => [g.title, g]))
    // Jane's agreement + certificate = ONE row, matched by the email in the certificate.
    const jane = review.groups.find((g) => g.fileNames.includes('Jane Smith Roof.pdf'))!
    expect(jane).toMatchObject({ certificates: 1, match: { customerId: C_JANE, how: 'email' }, completedOn: '2024-03-06', provider: 'docusign' })
    expect(jane.fileNames.sort()).toEqual(['Certificate.pdf', 'Jane Smith Roof.pdf'])
    expect(review.groups.find((g) => g.fileNames.includes('Bob Lee - Gutters.pdf'))!.match).toMatchObject({ customerId: C_BOB, how: 'exact' })
    expect(review.groups.find((g) => g.fileNames.includes('Zed Zero.pdf'))!.match).toEqual({ customerId: null, how: null, candidates: [] })
    expect(review.groups.find((g) => g.fileNames.includes('Declined thing.pdf'))!.notCompleted).toBe(true)
    expect(Object.keys(byTitle).length).toBe(4)

    // The owner overrides Bob → Ann and keeps Zed for later.
    const bob = review.groups.find((g) => g.fileNames.includes('Bob Lee - Gutters.pdf'))!
    const zed = review.groups.find((g) => g.fileNames.includes('Zed Zero.pdf'))!
    expect(await savePicks(w.client, ORG, run, { [bob.key]: C_ANN, [zed.key]: '' })).toEqual({ ok: true })

    const writesBefore = w.db.writes.length
    const start = await startSignedImport(w.client, ORG, run)
    expect(start).toEqual({ ok: true })
    run.status = 'importing'
    const done = await importBatch(w.client, ORG, USER, run)
    expect(done).toMatchObject({ ok: true, finished: true })

    const docs = w.db.tables.documents.filter((d) => d.id !== 'doc-existing')
    expect(docs).toHaveLength(4) // jane agreement + cert, bob, zed. NOT the declined one, NOT the duplicate.
    const agreement = docs.find((d) => d.filename === 'Jane_Smith_Roof.pdf')!
    const cert = docs.find((d) => d.filename === 'Certificate.pdf')!
    expect(agreement).toMatchObject({
      org_id: ORG,
      customer_id: C_JANE,
      property_id: P_JANE, // Jane has exactly one property
      job_id: null,
      document_role: 'signed_executed',
      is_protected: true,
      linked_record_type: null,
      linked_record_id: null,
      category: 'contract',
      status: 'active',
      sha256: sha(FILES.janeAgreement.bytes),
      import_source: 'docusign',
      import_envelope_id: ENV.toUpperCase(),
      mime_type: 'application/pdf',
      uploaded_by: USER,
    })
    expect(agreement.storage_path).toMatch(new RegExp(`^${ORG}/imports/[0-9a-f-]{36}_Jane_Smith_Roof\\.pdf$`))
    expect(cert).toMatchObject({ document_role: 'supporting_attachment', is_protected: true, import_envelope_id: agreement.import_envelope_id, customer_id: C_JANE, sha256: sha(FILES.janeCert.bytes) })
    expect((cert.title as string)).toMatch(/^Certificate of completion — /)
    expect(agreement.import_meta).toMatchObject({ completedOn: '2024-03-06', envelopeIdIsReal: true })
    const bobDoc = docs.find((d) => d.filename === 'Bob_Lee_-_Gutters.pdf')!
    expect(bobDoc.customer_id).toBe(C_ANN) // the owner's pick wins over the match
    expect(bobDoc).not.toHaveProperty('property_id') // Ann has none; never invented
    expect(docs.find((d) => d.filename === 'Zed_Zero.pdf')!.customer_id).toBeNull() // kept for later, NO customer created
    expect(w.db.tables.customers.map((c) => c.id).sort()).toEqual([C_JANE, C_BOB, C_ANN, C_OTHER].sort())

    // ONLY documents + the import tables were written. Never a customer, job, contract, sale, commission or payroll row.
    const tables = Array.from(new Set(w.db.writes.map((x) => x.table)))
    expect(tables.filter((t) => !COMPANY_WRITES_ALLOWED.has(t))).toEqual([])
    expect(w.db.writes.slice(writesBefore).every((x) => COMPANY_WRITES_ALLOWED.has(x.table))).toBe(true)
    // The unfinished signing's file is gone from storage; the stored ones are the 4 documents.
    expect(Array.from(w.storage.keys()).sort()).toEqual(docs.map((d) => d.storage_path as string).sort())

    const run2 = (await loadSignedRun(w.client, ORG, run.id))!
    expect(run2.status).toBe('done')
    const summary = await signedSummary(w.client, ORG, run2)
    expect(summary).toMatchObject({ added: 3, certificates: 1, waiting: 1, leftOut: 1, failed: [] })

    // Pressing Import again after it finished does nothing (not running).
    expect(await importBatch(w.client, ORG, USER, run2)).toMatchObject({ ok: false, status: 409 })
  })

  test('a duplicate (same SHA-256 as a document already on file) is skipped at the door and never uploaded', async () => {
    const w = world()
    const run = await openDraft(w)
    const { results } = await addFiles(w, run, [FILES.already, FILES.bob])
    expect(results[0]).toEqual({ sha256: sha(FILES.already.bytes), state: 'duplicate', title: 'Old contract' })
    expect(w.storage.size).toBe(1)
    // The same file twice in one batch, and again in a later batch: one item.
    const again = await registerFiles(w.client, ORG, run, [input(FILES.bob), input(FILES.bob)], undefined)
    expect(again.ok && again.results.map((r) => r.state)).toEqual(['added', 'added'])
    expect(w.db.tables.import_run_items).toHaveLength(1)
  })

  test('a duplicate that appears between check and import (someone else brought it over) is skipped, not doubled', async () => {
    const w = world()
    const run = await openDraft(w)
    await addFiles(w, run, [FILES.bob])
    await readAndMatch(w, run)
    expect(await startSignedImport(w.client, ORG, run)).toEqual({ ok: true })
    run.status = 'importing'
    // Another import (or upload) stores the same bytes first: the unique index on (company, sha256) refuses ours.
    w.db.tables.documents.push({ id: 'racer', org_id: ORG, customer_id: C_ANN, sha256: sha(FILES.bob.bytes), deleted_at: null })
    await importBatch(w.client, ORG, USER, run)
    expect(w.db.tables.documents.filter((d) => d.sha256 === sha(FILES.bob.bytes))).toHaveLength(1)
    expect(w.db.tables.import_run_items[0]).toMatchObject({ status: 'skipped', error: 'Already in your files' })
    expect(w.storage.size).toBe(0) // the extra copy is removed from storage
    expect(await signedSummary(w.client, ORG, (await loadSignedRun(w.client, ORG, run.id))!)).toMatchObject({ added: 0, duplicates: 1 })
  })

  test('refuses bad input at the door: not a PDF name, bad fingerprint, over the size limit', async () => {
    const w = world()
    const run = await openDraft(w)
    const good = input(FILES.bob)
    const r = await registerFiles(w.client, ORG, run, [{ ...good, name: 'run.exe' }, { ...good, sha256: 'nope' }, { ...good, size: 26 * 1024 * 1024 }, { ...good, size: 0 }], undefined)
    expect(r.ok && r.results.map((x) => (x.state === 'refused' ? x.reason : x.state))).toEqual(['not a PDF', 'bad fingerprint', 'over 25 MB', 'over 25 MB'])
    expect(w.db.tables.import_run_items).toHaveLength(0)
  })

  test('the stored bytes are re-read: a file that is not a PDF, or not the file that was announced, is rejected and removed', async () => {
    const w = world()
    const run = await openDraft(w)
    const reg = await registerFiles(w.client, ORG, run, [input(FILES.bob), input(FILES.mystery), input(FILES.janeCert)], undefined)
    if (!reg.ok) throw new Error('x')
    const [a, b, c] = reg.results as Array<Extract<RegisterResult, { state: 'upload' }>>
    w.storage.set(a.storagePath, Buffer.from('<html><script>alert(1)</script></html>')) // announced as a PDF
    w.storage.set(b.storagePath, pdf('a different PDF than announced')) // hash mismatch
    // c never arrives
    const conf = await confirmUploads(w.client, ORG, run, [a.itemId, b.itemId, c.itemId])
    expect(conf.ok && conf.results.map((x) => [x.ok, x.error])).toEqual([[false, 'Not a PDF'], [false, 'The file changed while it was uploading — add it again'], [false, 'The upload did not arrive — try again']])
    expect(w.removed).toEqual(expect.arrayContaining([a.storagePath, b.storagePath]))
    // The one that never arrived can be resumed (same item, fresh upload URL); the failed ones start over.
    const again = await registerFiles(w.client, ORG, run, [input(FILES.bob), input(FILES.mystery), input(FILES.janeCert)], undefined)
    expect(again.ok && again.results.map((x) => x.state)).toEqual(['upload', 'upload', 'upload'])
    const resumed = again.ok ? (again.results[2] as Extract<RegisterResult, { state: 'upload' }>) : null
    expect(resumed?.itemId).toBe(c.itemId)
  })

  test('a run with files that never finished uploading cannot start; dropping them lets it go on', async () => {
    const w = world()
    const run = await openDraft(w)
    await addFiles(w, run, [FILES.bob])
    await registerFiles(w.client, ORG, run, [input(FILES.mystery)], undefined) // registered, never uploaded
    await readAndMatch(w, run)
    const blocked = await startSignedImport(w.client, ORG, run)
    expect(blocked).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/1 file didn’t finish uploading/) })
    expect(await dropUnfinished(w.client, ORG, run)).toEqual({ ok: true, dropped: 1 })
    await readAndMatch(w, run)
    expect(await startSignedImport(w.client, ORG, run)).toEqual({ ok: true })
  })

  test('adding a file or an envelope list after matching makes the review ask for a new match', async () => {
    const w = world()
    const run = await openDraft(w)
    await addFiles(w, run, [FILES.bob])
    await readAndMatch(w, run)
    expect((await reviewGroups(w.client, ORG, run)).ready).toBe(true)
    await addFiles(w, run, [FILES.mystery])
    expect((await reviewGroups(w.client, ORG, run)).ready).toBe(false)
    expect(await startSignedImport(w.client, ORG, run)).toMatchObject({ ok: false, error: 'Match the documents first' })
  })

  test('an envelope list adds signers and marks a declined envelope as not finished', async () => {
    const w = world()
    const run = await openDraft(w)
    const csv = `Envelope Id,Subject,Status,Completed,Recipient Email\nENV-AAAA1111,Deck agreement,Completed,3/9/2024,bob@example.com\n`
    expect(await addEnvelopeIndex(w.client, ORG, run, 'envelopes.csv', csv)).toEqual({ ok: true, records: 1 })
    expect(await addEnvelopeIndex(w.client, ORG, run, 'envelopes.csv', csv)).toEqual({ ok: true, records: 1 }) // same list twice = one
    expect(w.db.tables.import_run_files).toHaveLength(1)
    expect(await addEnvelopeIndex(w.client, ORG, run, 'colors.csv', 'Color,Size\nred,L\n')).toMatchObject({ ok: false, status: 400 })
    const f = { name: 'Deck_env-aaaa1111.pdf', dir: '', bytes: pdf('Deck agreement body') }
    await addFiles(w, run, [f])
    await readAndMatch(w, run)
    const g = (await reviewGroups(w.client, ORG, run)).groups[0]
    expect(g).toMatchObject({ title: 'Deck agreement', completedOn: '2024-03-09', match: { customerId: C_BOB, how: 'email' } })
  })

  test('the owner’s source choice stands in for what the files say', async () => {
    const w = world()
    const run = await openDraft(w)
    await addFiles(w, run, [FILES.bob])
    expect(await setProvider(w.client, ORG, run, 'pandadoc')).toEqual({ ok: true })
    await readAndMatch(w, run)
    expect(await startSignedImport(w.client, ORG, run)).toEqual({ ok: true })
    run.status = 'importing'
    await importBatch(w.client, ORG, USER, run)
    expect(w.db.tables.documents.find((d) => d.sha256 === sha(FILES.bob.bytes))!.import_source).toBe('pandadoc')
  })

  test('picks: only this company’s customers, only known group keys; "don’t add" leaves a group out; a customer deleted meanwhile fails that item only', async () => {
    const w = world()
    const run = await openDraft(w)
    await addFiles(w, run, [FILES.bob, FILES.mystery])
    await readAndMatch(w, run)
    const groups = (await reviewGroups(w.client, ORG, run)).groups
    const [g1, g2] = groups
    expect(await savePicks(w.client, ORG, run, { [g1.key]: C_OTHER })).toMatchObject({ ok: false, status: 400 })
    expect(await savePicks(w.client, ORG, run, { '../../etc': C_BOB, [g1.key]: 'not-a-uuid' })).toEqual({ ok: true })
    expect(Object.keys((run.mapping as Record<string, Record<string, string>>).picks)).toEqual([]) // both junk entries dropped
    expect(await savePicks(w.client, ORG, run, { [g1.key]: C_JANE, [g2.key]: '-' })).toEqual({ ok: true })
    expect(await startSignedImport(w.client, ORG, run)).toEqual({ ok: true })
    run.status = 'importing'
    w.db.tables.customers = w.db.tables.customers.filter((c) => c.id !== C_JANE) // deleted after the pick
    await importBatch(w.client, ORG, USER, run)
    const items = w.db.tables.import_run_items
    expect(items.map((i) => i.status).sort()).toEqual(['failed', 'skipped'])
    expect(items.find((i) => i.status === 'failed')!.error).toMatch(/no longer exists/)
    expect(w.db.tables.documents.filter((d) => d.id !== 'doc-existing')).toHaveLength(0)
  })

  test('a cut-off batch runs again without doubling: the document id is fixed', async () => {
    const w = world()
    const run = await openDraft(w)
    await addFiles(w, run, [FILES.bob])
    await readAndMatch(w, run)
    await startSignedImport(w.client, ORG, run)
    run.status = 'importing'
    await importBatch(w.client, ORG, USER, run)
    // Pretend the process died right after the insert, before the item was marked done.
    w.db.tables.import_run_items.forEach((i) => Object.assign(i, { status: 'pending', target_id: null, applied: null }))
    await importBatch(w.client, ORG, USER, run)
    expect(w.db.tables.documents.filter((d) => d.sha256 === sha(FILES.bob.bytes))).toHaveLength(1)
    expect(w.db.tables.import_run_items[0]).toMatchObject({ status: 'done' })
  })

  test('undo takes the documents back off (soft delete, the stored file stays) and the run is undone', async () => {
    const w = world()
    const run = await openDraft(w)
    await addFiles(w, run, [FILES.bob, FILES.mystery])
    await readAndMatch(w, run)
    await startSignedImport(w.client, ORG, run)
    run.status = 'importing'
    await importBatch(w.client, ORG, USER, run)
    const done = (await loadSignedRun(w.client, ORG, run.id))!
    expect(await startSignedUndo(w.client, ORG, done)).toEqual({ ok: true })
    done.status = 'undoing'
    const u = await undoBatch(w.client, ORG, done)
    expect(u).toMatchObject({ ok: true, finished: true })
    expect(w.db.tables.documents.filter((d) => d.id !== 'doc-existing').every((d) => d.deleted_at)).toBe(true)
    expect((await loadSignedRun(w.client, ORG, run.id))!.status).toBe('undone')
  })

  test('discard throws a draft away, removes what was uploaded, and frees the company for a new import', async () => {
    const w = world()
    const run = await openDraft(w)
    await addFiles(w, run, [FILES.bob])
    expect(w.storage.size).toBe(1)
    expect(await discardSignedRun(w.client, ORG, run)).toEqual({ ok: true })
    expect(w.storage.size).toBe(0)
    expect(w.db.tables.import_run_items).toHaveLength(0)
    expect((await openSignedRun(w.client, ORG, USER)).ok).toBe(true)
  })

  test('a Jobber import and a signed-documents import are separate: one open run each, neither sees the other', async () => {
    const w = world()
    const jobber = await openRun(w.client, ORG, USER)
    const signed = await openSignedRun(w.client, ORG, USER)
    if (!jobber.ok || !signed.ok) throw new Error('open failed')
    expect(jobber.run.id).not.toBe(signed.run.id)
    expect(w.db.tables.import_runs.map((r) => r.source).sort()).toEqual(['jobber', 'signed_docs'])
    expect((await openRun(w.client, ORG, USER)).ok && (await openRun(w.client, ORG, USER) as { run: { id: string } }).run.id).toBe(jobber.run.id)
    expect((await openSignedRun(w.client, ORG, USER) as { run: { id: string } }).run.id).toBe(signed.run.id)
    // Each run answers only to its own kind of route.
    const { loadRun } = await import('@/lib/jobber-import/db')
    expect(await loadRun(w.client, ORG, signed.run.id)).toBeNull()
    expect(await loadSignedRun(w.client, ORG, jobber.run.id)).toBeNull()
  })

  test('another company never reaches this one’s run, items or customers', async () => {
    const w = world()
    const run = await openDraft(w)
    await addFiles(w, run, [FILES.bob])
    expect(await loadSignedRun(w.client, OTHER_ORG, run.id)).toBeNull()
    expect(await savePicks(w.client, OTHER_ORG, { ...run, id: run.id } as never, { 'env:x': C_JANE })).toMatchObject({ ok: false }) // A's customer is not B's
    // Company B runs its own import: the same certificate matches B's own customer (same email), never A's.
    const other = await openSignedRun(w.client, OTHER_ORG, USER)
    if (!other.ok) throw new Error('x')
    expect(other.run.id).not.toBe(run.id)
    await addFiles(w, other.run, [FILES.janeCert], OTHER_ORG)
    const items = w.db.tables.import_run_items.filter((i) => i.run_id === other.run.id)
    expect(items).toHaveLength(1)
    expect(items[0].org_id).toBe(OTHER_ORG)
    expect((items[0].payload as { storagePath: string }).storagePath.startsWith(`${OTHER_ORG}/imports/`)).toBe(true)
    await readAndMatch(w, other.run, OTHER_ORG)
    const rev = await reviewGroups(w.client, OTHER_ORG, other.run)
    expect(rev.groups).toHaveLength(1)
    expect(rev.groups[0].match).toMatchObject({ customerId: C_OTHER, how: 'email' }) // B's own customer, not A's Jane
    expect(JSON.stringify(rev)).not.toContain(C_JANE)
    // …and A's review of its own run shows none of B's.
    expect(JSON.stringify(await reviewGroups(w.client, ORG, run))).not.toContain(C_OTHER)
  })

  test('waiting for a customer: listed with the best match now; the owner assigns; a document that has a customer never moves', async () => {
    const w = world()
    const run = await openDraft(w)
    await addFiles(w, run, [FILES.mystery, FILES.janeCert])
    await readAndMatch(w, run)
    // Keep both for later.
    const groups = (await reviewGroups(w.client, ORG, run)).groups
    await savePicks(w.client, ORG, run, Object.fromEntries(groups.map((g) => [g.key, ''])))
    await startSignedImport(w.client, ORG, run)
    run.status = 'importing'
    await importBatch(w.client, ORG, USER, run)
    const held = await listHeld(w.client, ORG)
    expect(held.ready).toBe(true)
    expect(held.groups).toHaveLength(2)
    const cert = held.groups.find((g) => g.fileNames.includes('Certificate.pdf'))!
    expect(cert.match).toMatchObject({ customerId: C_JANE, how: 'email' })
    const zed = held.groups.find((g) => g.fileNames.includes('Zed Zero.pdf'))!
    expect(zed.match.customerId).toBeNull()

    expect(await assignHeld(w.client, ORG, [{ customerId: C_OTHER, documentIds: zed.documentIds }])).toMatchObject({ ok: false, status: 400 }) // not this company's
    expect(await assignHeld(w.client, ORG, [{ customerId: C_JANE, documentIds: cert.documentIds }])).toEqual({ ok: true, assigned: 1 })
    const jane = w.db.tables.documents.find((d) => d.id === cert.documentIds[0])!
    expect(jane).toMatchObject({ customer_id: C_JANE, property_id: P_JANE })
    // Assigning again (or to someone else) changes nothing: it already has a customer.
    expect(await assignHeld(w.client, ORG, [{ customerId: C_BOB, documentIds: cert.documentIds }])).toEqual({ ok: true, assigned: 0 })
    expect(jane.customer_id).toBe(C_JANE)
    // An ordinary document (no import_source) is never touched by this route.
    const PLAIN = '00000000-0000-4000-8000-0000000000aa'
    w.db.tables.documents.push({ id: PLAIN, org_id: ORG, customer_id: null, job_id: null, deleted_at: null, import_source: null })
    expect(await assignHeld(w.client, ORG, [{ customerId: C_BOB, documentIds: [PLAIN] }])).toEqual({ ok: true, assigned: 0 })
    expect(w.db.tables.documents.find((d) => d.id === PLAIN)!.customer_id).toBeNull()
    expect((await listHeld(w.client, ORG)).groups).toHaveLength(1)
  })

  test('customerFor: the pick wins, then the match as it stands, else nobody', () => {
    const item = (match: unknown) => ({ payload: { group: { key: 'g' }, match } }) as never
    expect(customerFor(item({ customerId: 'm' }), {})).toBe('m')
    expect(customerFor(item({ customerId: 'm' }), { g: 'p' })).toBe('p')
    expect(customerFor(item({ customerId: 'm' }), { g: '' })).toBeNull()
    expect(customerFor(item({ customerId: 'm' }), { g: '-' })).toBeNull()
    expect(customerFor(item(undefined), {})).toBeNull()
  })
})
