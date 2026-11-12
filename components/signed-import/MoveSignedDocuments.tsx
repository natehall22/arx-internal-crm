'use client'

/**
 * Settings → Move signed documents. Three steps on one screen: 1 Add files · 2 Check · 3 Add to customers (+ undo).
 * The ZIP is opened in THIS browser (lib/signed-import/zip.ts) and each PDF goes straight to storage, so a big export
 * never passes through our servers. Everything is saved on the import as it goes: close the tab and come back to continue.
 * Server: /api/admin/import/signed-docs (lib/signed-import/db.ts). Owners only.
 */
import * as React from 'react'

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, confirmDialog, Dialog, DialogContent, DialogFooter, FileDropZone, Input, Select, toast } from '@/components/ui'
import { decodeCsvBytes } from '@/lib/csv'
import { formatDate } from '@/lib/format'
import { DEFAULT_ZIP_LIMITS, MAX_CSV_BYTES, MAX_PDF_BYTES, REGISTER_BATCH, SIGNED_IMPORT_SOURCE_LABELS, SIGNED_IMPORT_SOURCES, signedOutsideLabel } from '@/lib/signed-import/files'
import { blobChunks, readZip, ZipLimitError } from '@/lib/signed-import/zip'
import { createClientBrowser } from '@/lib/supabase/client'

type Run = { id: string; status: 'draft' | 'importing' | 'done' | 'undoing' | 'undone' | 'discarded'; created_at: string }
type Candidate = { id: string; name: string }
type Group = {
  key: string
  title: string
  fileNames: string[]
  certificates: number
  completedOn: string | null
  provider: string | null
  notCompleted: boolean
  match: { customerId: string | null; how: 'email' | 'exact' | 'close' | null; candidates: Candidate[] }
  pick: string | null
  signers: string[]
}
type Review = { groups: Group[]; ready: boolean; unfinished: number; unread: number; duplicates: Array<{ name: string; title: string | null }> }
type Summary = { added: number; certificates: number; waiting: number; duplicates: number; leftOut: number; failed: Array<{ name: string; error: string }>; notPdf: Array<{ name: string; reason: string }>; notPdfCount: number }
type Progress = { total: number; pending: number; done: number; failed: number; skipped: number; undone: number; kept: number }
type State = { run: Run; indexFiles: Array<{ id: string; name: string; row_count: number }>; progress: Progress; review: Review | null; summary: Summary | null; provider: string }
type Held = { key: string; title: string; documentIds: string[]; fileNames: string[]; completedOn: string | null; source: string | null; signers: string[]; match: Group['match'] }

const BASE = '/api/admin/import/signed-docs'
const MAX_BUFFER_BYTES = 40 * 1024 * 1024

async function api<T = Record<string, unknown>>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Something went wrong')
  return data as T
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

type Upload = { name: string; dir: string; origin: string; bytes: Uint8Array }
type Registered = { sha256: string; state: 'upload' | 'duplicate' | 'added' | 'refused'; itemId?: string; storagePath?: string; bucket?: string; token?: string; reason?: string }

const lookWord = (g: Group) => (g.notCompleted ? 'Not finished signing' : !g.match.customerId ? 'Pick a customer' : g.match.how === 'close' ? 'Check these' : 'Matched')

export default function MoveSignedDocuments() {
  const [ready, setReady] = React.useState<boolean | null>(null)
  const [state, setState] = React.useState<State | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [percent, setPercent] = React.useState<number | null>(null)
  const [customers, setCustomers] = React.useState<Candidate[] | null>(null)
  const [picks, setPicks] = React.useState<Record<string, string>>({})
  const [searchFor, setSearchFor] = React.useState<Group | null>(null)
  const [fileNotes, setFileNotes] = React.useState<string[]>([])
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = React.useCallback(async (runId: string) => {
    const s = await api<State>(`${BASE}/${runId}`)
    setState(s)
    const saved = (s.review?.groups ?? []).reduce<Record<string, string>>((acc, g) => (g.pick !== null ? { ...acc, [g.key]: g.pick } : acc), {})
    setPicks(saved)
    return s
  }, [])

  React.useEffect(() => {
    api<{ ready: boolean; runs: Run[] }>(BASE)
      .then(async (r) => {
        setReady(r.ready)
        const open = r.runs.find((x) => x.status === 'draft' || x.status === 'importing' || x.status === 'undoing') ?? r.runs.find((x) => x.status === 'done')
        if (open) await load(open.id)
      })
      .catch((e) => {
        setReady(false)
        toast.error(e.message)
      })
  }, [load])

  const runId = state?.run.id ?? null
  const post = React.useCallback(async <T,>(id: string, body: Record<string, unknown>) => api<T>(`${BASE}/${id}`, body), [])

  async function ensureRun(): Promise<string> {
    if (state && state.run.status === 'draft') return state.run.id
    const r = await api<{ run: Run }>(BASE, {})
    return r.run.id
  }

  /** ZIP(s), PDFs and CSVs → hash → register → upload → confirm, in small batches so memory stays flat. */
  async function addFiles(files: File[]) {
    let id: string
    try {
      id = await ensureRun()
    } catch (e) {
      toast.error((e as Error).message)
      return
    }
    const notes: string[] = []
    const skipped: Array<{ name: string; reason: string }> = []
    let buffer: Upload[] = []
    let bufferBytes = 0
    let seen = 0
    const uploadClient = createClientBrowser()

    async function flush() {
      if (!buffer.length) return
      const batch = buffer
      buffer = []
      bufferBytes = 0
      for (let i = 0; i < batch.length; i += REGISTER_BATCH) {
        const part = batch.slice(i, i + REGISTER_BATCH)
        const hashes = await Promise.all(part.map((u) => sha256Hex(u.bytes)))
        const res = await post<{ results: Registered[] }>(id, {
          action: 'register',
          files: part.map((u, n) => ({ name: u.name, dir: u.dir, origin: u.origin, size: u.bytes.length, sha256: hashes[n] })),
        })
        const toConfirm: string[] = []
        for (let n = 0; n < part.length; n++) {
          const r = res.results.find((x) => x.sha256 === hashes[n])
          if (!r) continue
          if (r.state === 'refused') notes.push(`${part[n].name}: ${r.reason}`)
          if (r.state !== 'upload' || !r.itemId) continue
          const { error } = await uploadClient.storage.from(String(r.bucket)).uploadToSignedUrl(String(r.storagePath), String(r.token), new Blob([part[n].bytes as unknown as BlobPart], { type: 'application/pdf' }), { contentType: 'application/pdf' })
          // A retry after a cut-off finds the file already there: that is fine, confirm re-checks the bytes.
          if (error && !/exist/i.test(error.message)) notes.push(`${part[n].name}: could not upload (${error.message})`)
          else toConfirm.push(r.itemId)
        }
        for (let c = 0; c < toConfirm.length; c += 12) {
          const out = await post<{ results: Array<{ itemId: string; ok: boolean; error?: string }> }>(id, { action: 'confirm', itemIds: toConfirm.slice(c, c + 12) })
          for (const r of out.results) if (!r.ok) notes.push(r.error ?? 'A file did not pass the check')
        }
        seen += part.length
        setBusy(`Added ${seen} PDF${seen === 1 ? '' : 's'}…`)
      }
    }
    const take = async (u: Upload) => {
      buffer.push(u)
      bufferBytes += u.bytes.length
      if (buffer.length >= REGISTER_BATCH || bufferBytes >= MAX_BUFFER_BYTES) await flush()
    }
    const takeCsv = async (name: string, bytes: Uint8Array): Promise<void> => {
      if (bytes.length > MAX_CSV_BYTES) {
        skipped.push({ name, reason: 'List is over 4 MB — export it in parts' })
        return
      }
      const { text } = decodeCsvBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      try {
        await post(id, { action: 'addIndex', name, text })
      } catch (e) {
        skipped.push({ name, reason: (e as Error).message })
      }
    }

    try {
      for (const f of files) {
        setBusy(`Reading ${f.name}…`)
        if (/\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed') {
          try {
            const sum = await readZip(
              blobChunks(f),
              async (e) => {
                if (e.kind === 'csv') return takeCsv(e.name, e.bytes)
                await take({ name: e.name, dir: e.dir, origin: f.name, bytes: e.bytes })
              },
              DEFAULT_ZIP_LIMITS
            )
            for (const s of sum.skipped) skipped.push({ name: s.path, reason: s.reason })
            if (sum.aborted) notes.push(`${f.name}: ${sum.aborted}`)
          } catch (e) {
            notes.push(`${f.name}: ${e instanceof ZipLimitError ? e.message : 'could not be opened as a ZIP'}`)
          }
        } else if (/\.csv$/i.test(f.name)) {
          await takeCsv(f.name, new Uint8Array(await f.arrayBuffer()))
        } else if (/\.pdf$/i.test(f.name)) {
          if (f.size > MAX_PDF_BYTES) skipped.push({ name: f.name, reason: 'Over 25 MB' })
          else await take({ name: f.name, dir: '', origin: '', bytes: new Uint8Array(await f.arrayBuffer()) })
        } else skipped.push({ name: f.name, reason: 'Only ZIP, PDF and CSV files can be added' })
      }
      await flush()
      if (skipped.length) await post(id, { action: 'register', files: [], skipped: skipped.slice(0, 100) })
    } catch (e) {
      toast.error((e as Error).message)
    }
    setFileNotes(notes.slice(0, 30))
    setBusy(null)
    await load(id)
  }

  async function loop(id: string, action: 'read' | 'match', label: string) {
    let at = 0
    for (let guard = 0; guard < 2000; guard++) {
      const r = await post<{ done: boolean; at: number; of: number }>(id, action === 'match' ? { action, at } : { action })
      setBusy(`${label} ${Math.min(r.at, r.of)} of ${r.of}…`)
      setPercent(r.of ? Math.round((Math.min(r.at, r.of) / r.of) * 100) : 100)
      if (r.done) return
      at = r.at
    }
  }

  async function check() {
    if (!runId) return
    try {
      await loop(runId, 'read', 'Reading')
      await loop(runId, 'match', 'Matching')
      await load(runId)
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(null)
    setPercent(null)
  }

  async function runImport() {
    if (!state || !runId) return
    const review = state.review
    const adding = (review?.groups ?? []).filter((g) => !g.notCompleted && effective(g) !== '-')
    const ok = await confirmDialog({ title: `Add ${adding.length} document${adding.length === 1 ? '' : 's'}?`, description: 'They are added as read-only signed copies. You can undo the whole import afterwards.', confirmLabel: 'Add them' })
    if (!ok) return
    try {
      await flushPicks()
      // The first call starts the import and runs the first batch; each later call runs the next one.
      for (let guard = 0; guard < 2000; guard++) {
        const r = await post<{ finished: boolean; progress: Progress }>(runId, { action: 'import' })
        const p = r.progress
        const doneN = p.done + p.failed + p.skipped
        setBusy(`Adding ${doneN} of ${p.total}…`)
        setPercent(p.total ? Math.round((doneN / p.total) * 100) : 100)
        if (r.finished) break
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(null)
    setPercent(null)
    await load(runId)
  }

  async function undo() {
    if (!runId) return
    const ok = await confirmDialog({ title: 'Undo this import?', description: 'Documents added by it are removed. Anything you changed since is left alone.', confirmLabel: 'Undo it', destructive: true })
    if (!ok) return
    try {
      for (let guard = 0; guard < 2000; guard++) {
        const r = await post<{ finished: boolean }>(runId, { action: 'undo' })
        setBusy('Undoing…')
        if (r.finished) break
      }
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(null)
    await load(runId)
  }

  async function discard() {
    if (!runId) return
    if (!(await confirmDialog({ title: 'Start over?', description: 'Files added so far are thrown away. Nothing has been added to a customer.', confirmLabel: 'Start over', destructive: true }))) return
    try {
      await post(runId, { action: 'discard' })
      setState(null)
      setFileNotes([])
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const effective = (g: Group): string => picks[g.key] ?? (g.match.customerId && !g.notCompleted ? g.match.customerId : '')

  function changePick(key: string, value: string) {
    setPicks((p) => ({ ...p, [key]: value }))
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void flushPicks(), 600)
  }
  const picksRef = React.useRef(picks)
  picksRef.current = picks
  async function flushPicks() {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (!runId) return
    try {
      await post(runId, { action: 'picks', picks: picksRef.current })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function openSearch(g: Group) {
    setSearchFor(g)
    if (!customers && runId) {
      try {
        setCustomers((await post<{ customers: Candidate[] }>(runId, { action: 'customers' })).customers)
      } catch (e) {
        toast.error((e as Error).message)
      }
    }
  }

  if (ready === null) return <p className="text-ui-base text-ink">Loading…</p>
  if (!ready) return <Card><CardContent className="py-4 text-ui-base text-ink">Move signed documents turns on once the database update for it is applied. Ask your developer to apply migration 202611190010.</CardContent></Card>

  const status = state?.run.status
  const review = state?.review
  const hasFiles = (state?.progress.total ?? 0) > 0
  const groups = review?.groups ?? []
  const need = groups.filter((g) => !g.notCompleted && !effective(g) && picks[g.key] === undefined).length

  return (
    <div className="space-y-4 pb-28">
      {busy ? (
        <Card>
          <CardContent className="space-y-2 py-4" role="status" aria-live="polite">
            <p className="text-ui-base font-semibold text-ink">{busy}</p>
            {percent !== null ? <div className="h-2 w-full overflow-hidden rounded bg-surface-subtle"><div className="h-2 bg-brand" style={{ width: `${percent}%` }} /></div> : null}
            <p className="text-ui-sm text-ink">Keep this page open. If it closes, come back and carry on — nothing is lost.</p>
          </CardContent>
        </Card>
      ) : null}

      {(!state || status === 'draft') && !busy ? (
        <Card>
          <CardHeader><CardTitle>1. Add your signed documents</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-ui-base text-ink">Drop the ZIP you downloaded from DocuSign, Dropbox Sign or PandaDoc, or pick the PDFs. A list of envelopes (.csv) helps if you have one.</p>
            <FileDropZone multiple accept=".zip,.pdf,.csv,application/zip,application/pdf,text/csv" label="Drop a ZIP, PDFs or a CSV here, or tap to choose" hint="PDFs up to 25 MB each. Files are opened here in your browser, never run." onFiles={(f) => void addFiles(f)} />
            {state ? (
              <label className="block text-ui-base font-semibold text-ink">
                Where did these come from?
                <Select value={state.provider} onChange={(e) => void post(state.run.id, { action: 'provider', value: e.target.value }).then(() => load(state.run.id))}>
                  <option value="">Work it out from the files</option>
                  {SIGNED_IMPORT_SOURCES.map((s) => <option key={s} value={s}>{SIGNED_IMPORT_SOURCE_LABELS[s]}</option>)}
                </Select>
              </label>
            ) : null}
            {state && state.indexFiles.length ? (
              <ul className="text-ui-base text-ink">
                {state.indexFiles.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 py-1">
                    <span>{f.name} — {f.row_count} envelope{f.row_count === 1 ? '' : 's'}</span>
                    <Button variant="ghost" size="sm" onClick={() => void post(state.run.id, { action: 'removeIndex', fileId: f.id }).then(() => load(state.run.id))}>Remove</Button>
                  </li>
                ))}
              </ul>
            ) : null}
            {hasFiles ? <p className="text-ui-base text-ink"><strong>{state?.progress.total}</strong> file{state?.progress.total === 1 ? '' : 's'} added so far.</p> : null}
            {fileNotes.length ? <ul className="list-disc pl-5 text-ui-sm text-ink">{fileNotes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
            <details className="text-ui-base text-ink">
              <summary className="min-h-tap cursor-pointer py-2 font-semibold">How do I get these files out?</summary>
              <ul className="list-disc space-y-1 pl-5">
                <li>DocuSign: Manage → select the completed envelopes → Download → “Combine PDF” off, “Certificate of completion” on. A report of envelopes can be exported as CSV.</li>
                <li>Dropbox Sign: Documents → select completed → Download (PDF, with audit trail).</li>
                <li>PandaDoc: Documents → select completed → Download (PDF); the certificate is a separate download.</li>
              </ul>
              <p className="mt-1">Menus change; if yours differs, any ZIP or folder of the signed PDFs works.</p>
            </details>
            {hasFiles ? <Button variant="ghost" onClick={() => void discard()}>Start over</Button> : null}
          </CardContent>
        </Card>
      ) : null}

      {state && status === 'draft' && !busy && hasFiles ? (
        <>
          {review && (review.unfinished > 0 || review.unread > 0) ? (
            <Card><CardContent className="space-y-2 py-4 text-ui-base text-ink">
              {review.unfinished ? <p>{review.unfinished} file{review.unfinished === 1 ? ' was' : 's were'} not fully uploaded (the page closed part-way). Add the same files again, or leave them out.</p> : null}
              {review.unread ? <p>{review.unread} file{review.unread === 1 ? ' has' : 's have'} not been read yet — press Check.</p> : null}
              {review.unfinished ? <Button variant="secondary" onClick={() => void post(state.run.id, { action: 'dropUnfinished' }).then(() => load(state.run.id))}>Leave them out</Button> : null}
            </CardContent></Card>
          ) : null}

          {review && review.ready ? (
            <Card>
              <CardHeader><CardTitle>2. Check who each one belongs to</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <p className="text-ui-base text-ink">Customers are never created here. A document with no customer is kept in a list and can be given one later.</p>
                {review.duplicates.length ? <p className="text-ui-sm text-ink">{review.duplicates.length} file{review.duplicates.length === 1 ? ' is' : 's are'} already in your documents and will be skipped.</p> : null}
                {(['Pick a customer', 'Check these', 'Matched', 'Not finished signing'] as const).map((section) => {
                  const rows = groups.filter((g) => lookWord(g) === section)
                  if (!rows.length) return null
                  return (
                    <details key={section} open={section !== 'Matched'}>
                      <summary className="min-h-tap cursor-pointer py-2 text-ui-base font-semibold text-ink">{section} ({rows.length})</summary>
                      <ul className="divide-y divide-border">
                        {rows.map((g) => (
                          <li key={g.key} className="space-y-1 py-3">
                            <p className="text-ui-base font-semibold text-ink">{g.title}{g.certificates ? <Badge className="ml-2">+ certificate</Badge> : null}</p>
                            <p className="text-ui-sm text-ink">{g.fileNames.join(', ')}{g.completedOn ? ` · signed ${formatDate(g.completedOn)}` : ''}{g.signers.length ? ` · ${g.signers.join(', ')}` : ''}</p>
                            {g.notCompleted ? <p className="text-ui-sm text-ink">Not finished signing, so it is left out.</p> : (
                              <div className="flex flex-col gap-2 sm:flex-row">
                                <Select aria-label={`Customer for ${g.title}`} value={picks[g.key] ?? (g.match.customerId ?? '')} onChange={(e) => (e.target.value === '__other' ? void openSearch(g) : changePick(g.key, e.target.value))}>
                                  <option value="">Keep for later</option>
                                  <option value="-">Don’t add</option>
                                  {g.match.candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                  {picks[g.key] && !g.match.candidates.some((c) => c.id === picks[g.key]) && picks[g.key].length > 1 ? <option value={picks[g.key]}>{customers?.find((c) => c.id === picks[g.key])?.name ?? 'Chosen customer'}</option> : null}
                                  <option value="__other">Someone else…</option>
                                </Select>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )
                })}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      {state && status && status !== 'draft' && !busy ? <Finished state={state} onUndo={() => void undo()} /> : null}

      <HeldList disabled={!!busy} />

      {searchFor ? (
        <CustomerSearch
          title={searchFor.title}
          customers={customers}
          onClose={() => setSearchFor(null)}
          onPick={(id) => {
            changePick(searchFor.key, id)
            setSearchFor(null)
          }}
        />
      ) : null}

      {status === 'draft' && hasFiles && !busy ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <span className="text-ui-sm text-ink">{review?.ready ? (need ? `${need} still need a choice (or they are kept for later)` : `${groups.filter((g) => !g.notCompleted && effective(g) !== '-').length} ready`) : `${state?.progress.total} files added`}</span>
            {review?.ready ? <Button onClick={() => void runImport()}>Add {groups.filter((g) => !g.notCompleted && effective(g) !== '-').length} documents</Button> : <Button onClick={() => void check()}>Next: match to customers</Button>}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Finished({ state, onUndo }: { state: State; onUndo: () => void }) {
  const s = state.summary
  const running = state.run.status === 'importing' || state.run.status === 'undoing'
  return (
    <Card>
      <CardHeader><CardTitle>{state.run.status === 'undone' ? 'Import undone' : running ? 'Import in progress' : '3. Done'}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-ui-base text-ink">
        {s ? (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <li><strong>{s.added}</strong> added</li>
            <li><strong>{s.certificates}</strong> certificates attached</li>
            <li><strong>{s.waiting}</strong> waiting for a customer</li>
            <li><strong>{s.duplicates}</strong> already there</li>
            <li><strong>{s.leftOut}</strong> left out</li>
            <li><strong>{s.failed.length}</strong> failed</li>
          </ul>
        ) : null}
        {s?.failed.length ? <ul className="list-disc pl-5 text-ui-sm">{s.failed.slice(0, 20).map((f, i) => <li key={i}>{f.name}: {f.error}</li>)}</ul> : null}
        {s?.notPdf.length ? <details><summary className="min-h-tap cursor-pointer py-2 font-semibold">{s.notPdfCount} file{s.notPdfCount === 1 ? '' : 's'} were not PDFs or not read</summary><ul className="list-disc pl-5 text-ui-sm">{s.notPdf.map((f, i) => <li key={i}>{f.name}: {f.reason}</li>)}</ul></details> : null}
        <p className="text-ui-sm">{signedOutsideLabel('other')}</p>
        {state.run.status === 'done' ? <Button variant="secondary" onClick={onUndo}>Undo this import</Button> : null}
      </CardContent>
    </Card>
  )
}

function CustomerSearch({ title, customers, onPick, onClose }: { title: string; customers: Candidate[] | null; onPick: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = React.useState('')
  const shown = (customers ?? []).filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Pick a customer" description={title}>
        <Input autoFocus aria-label="Search customers" placeholder="Start typing a name" value={q} onChange={(e) => setQ(e.target.value)} />
        {customers === null ? <p className="text-ui-base text-ink">Loading…</p> : null}
        <ul className="max-h-[50dvh] divide-y divide-border overflow-auto">
          {shown.map((c) => <li key={c.id}><button type="button" className="min-h-tap w-full px-2 py-2 text-left text-ui-base text-ink hover:bg-surface-subtle" onClick={() => onPick(c.id)}>{c.name}</button></li>)}
          {customers && !shown.length ? <li className="py-2 text-ui-base text-ink">No one by that name.</li> : null}
        </ul>
        <DialogFooter><Button variant="secondary" onClick={onClose}>Cancel</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Documents added earlier with no customer. Suggested matches can be accepted in one tap. */
function HeldList({ disabled }: { disabled: boolean }) {
  const [held, setHeld] = React.useState<{ groups: Held[]; customers: Candidate[] } | null>(null)
  const [chosen, setChosen] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)
  const reload = React.useCallback(() => api<{ ready: boolean; groups: Held[]; customers: Candidate[] }>(`${BASE}/held`).then((r) => setHeld(r.ready ? r : null)).catch(() => setHeld(null)), [])
  React.useEffect(() => { void reload() }, [reload])
  if (!held || !held.groups.length) return null

  async function assign(list: Array<{ customerId: string; documentIds: string[] }>) {
    if (!list.length) return
    setSaving(true)
    try {
      const r = await api<{ assigned: number }>(`${BASE}/held`, { assignments: list })
      toast.success(`${r.assigned} document${r.assigned === 1 ? '' : 's'} added to customers`)
      setChosen({})
      await reload()
    } catch (e) {
      toast.error((e as Error).message)
    }
    setSaving(false)
  }
  const suggested = held.groups.filter((g) => g.match.customerId).map((g) => ({ customerId: g.match.customerId as string, documentIds: g.documentIds }))
  return (
    <Card>
      <CardHeader><CardTitle>Waiting for a customer ({held.groups.length})</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-ui-base text-ink">These were kept for later. Give each one a customer when they are in your system.</p>
        {suggested.length ? <Button variant="secondary" disabled={disabled || saving} onClick={() => void assign(suggested)}>Add all {suggested.length} suggested</Button> : null}
        <ul className="divide-y divide-border">
          {held.groups.map((g) => (
            <li key={g.key} className="space-y-1 py-3">
              <p className="text-ui-base font-semibold text-ink">{g.title}</p>
              <p className="text-ui-sm text-ink">{g.fileNames.join(', ')}{g.completedOn ? ` · signed ${formatDate(g.completedOn)}` : ''}</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select aria-label={`Customer for ${g.title}`} value={chosen[g.key] ?? g.match.customerId ?? ''} onChange={(e) => setChosen((c) => ({ ...c, [g.key]: e.target.value }))}>
                  <option value="">Choose a customer…</option>
                  {g.match.candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  {held.customers.filter((c) => !g.match.candidates.some((x) => x.id === c.id)).slice(0, 500).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Button disabled={disabled || saving || !(chosen[g.key] ?? g.match.customerId)} onClick={() => void assign([{ customerId: (chosen[g.key] ?? g.match.customerId) as string, documentIds: g.documentIds }])}>Add</Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
