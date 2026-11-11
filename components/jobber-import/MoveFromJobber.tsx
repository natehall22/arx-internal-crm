'use client'

/**
 * Settings → Move from Jobber. Three steps on one screen: 1 Add files · 2 Check · 3 Bring it over (+ contracts & files,
 * undo). Everything is saved on the import as it goes, so closing the tab and coming back continues where it stopped.
 * Server: /api/admin/import/jobber (lib/jobber-import/db.ts). Owners only.
 */
import * as React from 'react'
import Link from 'next/link'

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, confirmDialog, Dialog, DialogContent, DialogFooter, FileDropZone, Select, toast } from '@/components/ui'
import { uploadCustomerDocument } from '@/lib/customer-document-upload'
import { formatDate, formatMoney } from '@/lib/format'
import { JOBBER_FILE_KIND_LABELS, JOBBER_FILE_KINDS, resolveMapping, targetChoices, type JobberFileKind } from '@/lib/jobber-import/columns'
import type { FileMatch } from '@/lib/jobber-import/files-match'
import type { PlanSummary, Problem } from '@/lib/jobber-import/plan'

type Run = {
  id: string
  status: 'draft' | 'importing' | 'done' | 'undoing' | 'undone' | 'discarded'
  mapping: Record<string, Record<string, string>>
  options: { dateOrder: 'mdy' | 'dmy' | null; trade: string | null; skipArchived: boolean }
  summary: PlanSummary | null
  checked_at: string | null
  created_at: string
  finished_at: string | null
}
type RunFile = { id: string; name: string; kind: JobberFileKind | 'unknown'; headers: string[]; row_count: number; first_row?: string[] | null }
type Progress = { total: number; pending: number; done: number; failed: number; skipped: number; undone: number; kept: number }
type LookItem = { id: string; kind: string; label: string; status: string; problems: Problem[]; error: string | null; undo_note: string | null }
type State = {
  run: Run
  files: RunFile[]
  progress: Progress
  trades: Array<{ slug: string; label: string }>
  needsALook: LookItem[]
  reviewPlans: Array<{ planId: string; customerId: string; name: string; review: string[] }>
}

const MAX_BYTES = 4 * 1024 * 1024
const BASE = '/api/admin/import/jobber'

async function api<T = Record<string, unknown>>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Something went wrong')
  return data as T
}

const KIND_WORDS: Record<string, string> = {
  custom_field: 'Customer fields',
  price_item: 'Price book items',
  customer: 'Customers',
  property: 'Properties',
  plan: 'Service plans',
  invoice: 'Invoices',
  history: 'Quotes & past jobs',
  document: 'Files',
}

function documentCategory(title: string): string {
  const t = title.toLowerCase()
  if (/contract|agreement|signed/.test(t)) return 'contract'
  if (/invoice|receipt/.test(t)) return 'invoice'
  if (/warrant/.test(t)) return 'warranty'
  if (/permit/.test(t)) return 'permit'
  if (/insurance|\bcoi\b|certificate/.test(t)) return 'insurance'
  return 'misc'
}

export default function MoveFromJobber() {
  const [ready, setReady] = React.useState<boolean | null>(null)
  const [runs, setRuns] = React.useState<Run[]>([])
  const [state, setState] = React.useState<State | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [mappingFor, setMappingFor] = React.useState<RunFile | null>(null)

  const load = React.useCallback(async (runId: string) => {
    const s = await api<State>(`${BASE}/${runId}`)
    setState(s)
    return s
  }, [])

  React.useEffect(() => {
    api<{ ready: boolean; runs: Run[] }>(BASE)
      .then(async (r) => {
        setReady(r.ready)
        setRuns(r.runs)
        const open = r.runs.find((x) => x.status === 'draft' || x.status === 'importing' || x.status === 'undoing') ?? r.runs.find((x) => x.status === 'done')
        if (open) await load(open.id)
      })
      .catch((e) => {
        setReady(false)
        toast.error(e.message)
      })
  }, [load])

  async function ensureRun(): Promise<string> {
    if (state && state.run.status === 'draft') return state.run.id
    const r = await api<{ run: Run }>(BASE, {})
    return r.run.id
  }

  async function addFiles(files: File[]) {
    const csv = files.filter((f) => /\.csv$/i.test(f.name) || f.type === 'text/csv')
    if (csv.length < files.length) toast.error('Only .csv files from Jobber’s exports can be read here')
    if (!csv.length) return
    let runId: string
    try {
      runId = await ensureRun()
    } catch (e) {
      toast.error((e as Error).message)
      return
    }
    for (let i = 0; i < csv.length; i++) {
      const f = csv[i]
      setBusy(`Reading ${f.name} (${i + 1} of ${csv.length})…`)
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name} is over 4 MB — export it in parts`)
        continue
      }
      try {
        const res = await api<{ detected: boolean }>(`${BASE}/${runId}`, { action: 'addFile', name: f.name, text: await f.text() })
        if (!res.detected) toast.error(`${f.name}: we couldn’t tell which Jobber export this is — pick it below`)
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message}`)
      }
    }
    setBusy(null)
    await load(runId)
  }

  async function post(body: Record<string, unknown>, label?: string) {
    if (!state) return null
    setBusy(label ?? 'Saving…')
    try {
      return await api(`${BASE}/${state.run.id}`, body)
    } catch (e) {
      toast.error((e as Error).message)
      return null
    } finally {
      setBusy(null)
      await load(state.run.id).catch(() => null)
    }
  }

  async function check(next?: Partial<Run['options']>) {
    if (!state) return
    if (next) await post({ action: 'update', options: next })
    await post({ action: 'check' }, 'Checking every row…')
  }

  /** Runs batches until done (import or undo). Safe to leave: coming back continues. */
  async function loop(action: 'import' | 'undo') {
    if (!state) return
    const runId = state.run.id
    setBusy(action === 'import' ? 'Bringing it over…' : 'Undoing…')
    try {
      for (let guard = 0; guard < 5000; guard++) {
        const r = await api<{ progress: Progress; finished: boolean }>(`${BASE}/${runId}`, { action })
        setState((s) => (s ? { ...s, progress: r.progress, run: { ...s.run, status: action === 'import' ? 'importing' : 'undoing' } } : s))
        if (r.finished) break
      }
      toast.success(action === 'import' ? 'Done — everything is over' : 'Import undone')
    } catch (e) {
      toast.error(`${(e as Error).message}. Tap again to continue — nothing is done twice.`)
    } finally {
      setBusy(null)
      await load(runId).catch(() => null)
      api<{ runs: Run[] }>(BASE).then((r) => setRuns(r.runs)).catch(() => null)
    }
  }

  if (ready === null) return <p className="py-8 text-ui-base text-ink">Loading…</p>
  if (!ready)
    return (
      <Card>
        <CardContent className="py-6 text-ui-base text-ink">Moving from Jobber turns on once the database update for it is applied.</CardContent>
      </Card>
    )

  const run = state?.run
  const step = !run || run.status === 'draft' ? (run?.summary ? 2 : 1) : 3
  const files = state?.files ?? []
  const usable = files.filter((f) => f.kind !== 'unknown')

  return (
    <div className="space-y-4 pb-28">
      <ol className="flex gap-2 text-ui-sm font-semibold" aria-label="Steps">
        {['Add files', 'Check', 'Bring it over'].map((s, i) => (
          <li key={s} className={`flex-1 rounded-ui border px-2 py-2 text-center ${step === i + 1 ? 'border-brand-700 bg-brand-50 text-ink' : 'border-surface-line bg-surface text-ink'}`} aria-current={step === i + 1 ? 'step' : undefined}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {busy ? (
        <p role="status" className="rounded-ui bg-brand-50 px-3 py-2 text-ui-base font-semibold text-ink">
          {busy}
        </p>
      ) : null}

      {step === 1 || (step === 2 && run?.status === 'draft') ? (
        <Card>
          <CardHeader>
            <CardTitle>1. Add your Jobber files</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FileDropZone accept=".csv,text/csv" onFiles={addFiles} disabled={!!busy} label="Drop Jobber .csv files here or tap to choose" hint="Clients (all parts), Recurring jobs, Visits, Invoices, Quotes, One-off jobs, Products & services" />
            <HowToExport />
            {files.length ? (
              <ul className="divide-y divide-surface-line rounded-ui border border-surface-line">
                {files.map((f) => {
                  const kind = f.kind === 'unknown' ? null : f.kind
                  const unknownCols = kind ? resolveMapping(kind, f.headers, run?.mapping[f.id]).filter((m) => !m.known).length : 0
                  return (
                    <li key={f.id} className="space-y-2 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="break-all text-ui-base font-semibold text-ink">{f.name}</span>
                        <span className="text-ui-sm text-ink">{f.row_count.toLocaleString()} rows</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          aria-label={`What ${f.name} is`}
                          value={f.kind}
                          onChange={(e) => post({ action: 'update', fileId: f.id, kind: e.target.value })}
                          className="min-w-0 flex-1"
                          disabled={!!busy}
                        >
                          {f.kind === 'unknown' ? <option value="unknown">Pick what this file is…</option> : null}
                          {JOBBER_FILE_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {JOBBER_FILE_KIND_LABELS[k]}
                            </option>
                          ))}
                        </Select>
                        {kind ? (
                          <Button variant="secondary" size="sm" onClick={() => setMappingFor(f)}>
                            {unknownCols ? `${unknownCols} column${unknownCols === 1 ? '' : 's'} to check` : 'Columns'}
                          </Button>
                        ) : null}
                        <Button variant="ghost" size="sm" onClick={() => post({ action: 'removeFile', fileId: f.id })} disabled={!!busy}>
                          Remove
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : null}
            {run && step === 1 ? (
              <Button variant="ghost" size="sm" onClick={async () => (await confirmDialog({ title: 'Start over?', description: 'The files added here are thrown away. Nothing has been imported.', confirmLabel: 'Start over', destructive: true })) && post({ action: 'discard' }).then(() => setState(null))}>
                Start over
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {step === 2 && run?.summary && state ? <CheckView state={state} busy={!!busy} onCheck={check} /> : null}

      {step === 3 && state ? <ImportView state={state} busy={!!busy} onContinue={loop} onReload={() => load(state.run.id)} /> : null}

      {run && (run.status === 'done' || run.status === 'undone') ? (
        <Button
          variant="secondary"
          className="w-full"
          disabled={!!busy}
          onClick={async () => {
            try {
              const r = await api<{ run: Run }>(BASE, {})
              await load(r.run.id)
            } catch (e) {
              toast.error((e as Error).message)
            }
          }}
        >
          Start another import
        </Button>
      ) : null}

      <PastImports runs={runs.filter((r) => r.id !== run?.id && r.status !== 'discarded')} />

      {/* Sticky primary action, in thumb reach. */}
      {run && run.status === 'draft' ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-surface-line bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-3xl gap-2">
            {step === 1 ? (
              <Button className="flex-1" disabled={!usable.length || !!busy} onClick={() => check(!run.options.trade && state?.trades.length ? { trade: state.trades[0].slug } : undefined)}>
                Next: check {usable.length ? `${usable.length} file${usable.length === 1 ? '' : 's'}` : ''}
              </Button>
            ) : (
              <>
                <Button variant="secondary" disabled={!!busy} onClick={() => post({ action: 'update' })}>
                  Back
                </Button>
                <Button
                  className="flex-1"
                  disabled={!!busy || !run.summary || run.summary.nothingToImport}
                  onClick={async () => {
                    if (!(await confirmDialog({ title: 'Bring it over now?', description: 'You can undo the whole import afterwards. Plans come in paused until you check them.', confirmLabel: 'Import' }))) return
                    await loop('import')
                  }}
                >
                  Import
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {mappingFor && run ? (
        <MappingSheet
          file={mappingFor}
          choices={run.mapping[mappingFor.id] ?? {}}
          onClose={() => setMappingFor(null)}
          onSave={async (columns) => {
            await post({ action: 'update', fileId: mappingFor.id, columns })
            setMappingFor(null)
          }}
        />
      ) : null}
    </div>
  )
}

function HowToExport() {
  return (
    <details className="rounded-ui border border-surface-line p-3 text-ui-base text-ink">
      <summary className="min-h-tap cursor-pointer font-semibold">How to get these files out of Jobber</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          <b>Clients:</b> Clients → More Actions → Export Clients → CSV. Jobber emails it; over ~1,500 clients come as several files — add them all.
        </li>
        <li>
          <b>Recurring jobs, One-off jobs, Visits, Invoices, Quotes:</b> Insights → Reports → open the report → set the date range to all time → Export to CSV → “All columns”. Each is emailed to you.
        </li>
        <li>
          <b>Products & services:</b> Settings (gear) → Products & Services → Export to CSV at the bottom.
        </li>
        <li>Payments don’t come over: invoices arrive with Jobber’s status and balance, and what was already paid is noted on each one.</li>
      </ul>
    </details>
  )
}

function MappingSheet({ file, choices, onClose, onSave }: { file: RunFile; choices: Record<string, string>; onClose: () => void; onSave: (c: Record<string, string>) => void }) {
  const kind = file.kind as JobberFileKind
  const [showAll, setShowAll] = React.useState(false)
  const [picked, setPicked] = React.useState<Record<string, string>>(choices)
  const mapping = resolveMapping(kind, file.headers, picked)
  const rows = mapping.map((m, i) => ({ ...m, sample: file.first_row?.[i] ?? '' })).filter((m) => showAll || !m.known)
  const options = targetChoices(kind)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Columns in ${file.name}`} description="Where each column goes. Columns we didn’t recognise are listed first.">
        {rows.length === 0 ? <p className="text-ui-base text-ink">Every column was recognised.</p> : null}
        <ul className="space-y-3">
          {rows.map((m) => (
            <li key={m.header} className="space-y-1">
              <label className="block text-ui-base font-semibold text-ink" htmlFor={`col-${m.header}`}>
                {m.header}
                {m.sample ? <span className="block text-ui-sm font-normal text-ink">e.g. {m.sample.slice(0, 60)}</span> : null}
              </label>
              <Select id={`col-${m.header}`} value={m.target} onChange={(e) => setPicked((p) => ({ ...p, [m.header]: e.target.value }))}>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show only columns to check' : 'Show every column'}
        </Button>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(picked)}>Save columns</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Count({ label, n, sub }: { label: string; n: number; sub?: string }) {
  return (
    <div className="rounded-ui border border-surface-line bg-surface p-3">
      <p className="text-ui-sm font-semibold text-ink">{label}</p>
      <p className="text-ui-lg font-bold tabular-nums text-ink">{n.toLocaleString()}</p>
      {sub ? <p className="text-ui-sm text-ink">{sub}</p> : null}
    </div>
  )
}

function CheckView({ state, busy, onCheck }: { state: State; busy: boolean; onCheck: (o?: Partial<Run['options']>) => void }) {
  const s = state.run.summary!
  const c = s.counts
  const [allProblems, setAllProblems] = React.useState(false)
  const newOrUpdated = (k: keyof typeof c) => c[k].create + c[k].update
  const problems = allProblems ? s.problems : s.problems.slice(0, 30)
  return (
    <Card>
      <CardHeader>
        <CardTitle>2. Check before anything is saved</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Count label="New customers" n={c.customer.create} sub={c.customer.link || c.customer.update ? `${c.customer.link + c.customer.update} already here — matched` : undefined} />
          <Count label="Properties" n={newOrUpdated('property')} />
          <Count label="Service plans" n={s.plans.total} sub="Come in paused — check each, then Resume" />
          <Count label="Open invoices" n={s.invoices.open} sub={`${formatMoney(s.invoices.openBalanceCents / 100)} still owed`} />
          <Count label="Paid / draft invoices" n={s.invoices.paid + s.invoices.draft + s.invoices.void} />
          <Count label="Price book items" n={newOrUpdated('price_item')} />
          <Count label="Quotes & past jobs" n={c.history.create} sub="Kept on the customer as history" />
        </div>
        {s.newFields.length ? (
          <p className="text-ui-base text-ink">
            <b>New customer fields:</b> {s.newFields.map((f) => `${f.label}${f.entity === 'property' ? ' (property)' : ''}`).join(', ')}
          </p>
        ) : null}

        <div className="space-y-3 rounded-ui border border-surface-line p-3">
          {state.trades.length && s.counts.plan.create + s.counts.plan.update + s.counts.plan.skip > 0 ? (
            <label className="block space-y-1 text-ui-base font-semibold text-ink">
              Service type for the plans
              <Select value={state.run.options.trade ?? ''} disabled={busy} onChange={(e) => onCheck({ trade: e.target.value || null })}>
                <option value="">Pick one…</option>
                {state.trades.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          {s.dateOrder.ambiguous || s.dateOrder.conflicting || s.dateOrder.chosen ? (
            <label className="block space-y-1 text-ui-base font-semibold text-ink">
              Dates in your files
              <Select value={s.dateOrder.order} disabled={busy} onChange={(e) => onCheck({ dateOrder: e.target.value as 'mdy' | 'dmy' })}>
                <option value="mdy">Month / day / year (03/18/2025)</option>
                <option value="dmy">Day / month / year (18/03/2025)</option>
              </Select>
            </label>
          ) : null}
          <label className="flex min-h-tap items-center gap-2 text-ui-base text-ink">
            <input type="checkbox" className="h-5 w-5" checked={state.run.options.skipArchived} disabled={busy} onChange={(e) => onCheck({ skipArchived: e.target.checked })} />
            Leave out clients archived in Jobber
          </label>
        </div>

        {s.duplicates.length ? (
          <details className="rounded-ui border border-surface-line p-3" open={s.duplicates.length <= 5}>
            <summary className="min-h-tap cursor-pointer text-ui-base font-semibold text-ink">Possible duplicates ({s.duplicates.length})</summary>
            <ul className="mt-2 space-y-2 text-ui-base text-ink">
              {s.duplicates.slice(0, 200).map((d, i) => (
                <li key={i}>
                  <b>{d.names.join(' · ')}</b> — {d.reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <div>
          <p className="text-ui-base font-semibold text-ink">
            {s.problemCount.errors ? <Badge tone="danger">{s.problemCount.errors} left out</Badge> : null} {s.problemCount.warnings ? <Badge tone="warning">{s.problemCount.warnings} to know about</Badge> : null}
            {!s.problemCount.errors && !s.problemCount.warnings ? 'No problems found.' : null}
          </p>
          {problems.length ? (
            <ul className="mt-2 divide-y divide-surface-line rounded-ui border border-surface-line text-ui-base text-ink">
              {problems.map((p, i) => (
                <li key={i} className="p-2">
                  <span className={p.severity === 'error' ? 'font-semibold text-danger' : 'font-semibold'}>{p.severity === 'error' ? 'Left out' : 'Note'}</span> · {p.file}
                  {p.row ? ` row ${p.row}` : ''}: {p.message}
                </li>
              ))}
            </ul>
          ) : null}
          {s.problems.length > 30 ? (
            <Button variant="ghost" size="sm" onClick={() => setAllProblems((v) => !v)}>
              {allProblems ? 'Show fewer' : `Show all ${s.problems.length}`}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function ImportView({ state, busy, onContinue, onReload }: { state: State; busy: boolean; onContinue: (a: 'import' | 'undo') => void; onReload: () => void }) {
  const { run, progress } = state
  const working = run.status === 'importing' || run.status === 'undoing'
  const pct = progress.total ? Math.round(((progress.total - progress.pending) / progress.total) * 100) : 0
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{run.status === 'undone' ? 'This import was undone' : run.status === 'undoing' ? 'Undoing the import' : run.status === 'done' ? '3. Brought over' : '3. Bringing it over'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {working ? (
            <>
              <div className="h-3 w-full overflow-hidden rounded-full bg-surface-subtle" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-brand-700" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-ui-base text-ink">{pct}% — you can leave this page; it continues when you come back.</p>
              {!busy ? <Button onClick={() => onContinue(run.status === 'importing' ? 'import' : 'undo')}>Continue</Button> : null}
            </>
          ) : (
            <p className="text-ui-base text-ink">
              {progress.done.toLocaleString()} brought over{progress.failed ? `, ${progress.failed} couldn’t be` : ''}
              {progress.undone ? `, ${progress.undone} undone` : ''}
              {progress.kept ? `, ${progress.kept} kept because they were changed or used since` : ''}.
            </p>
          )}

          {state.reviewPlans.length ? (
            <details className="rounded-ui border border-surface-line p-3" open>
              <summary className="min-h-tap cursor-pointer text-ui-base font-semibold text-ink">Plans to check before they start ({state.reviewPlans.length})</summary>
              <p className="mt-1 text-ui-sm text-ink">Each plan is paused. Open the customer, check how often and the price, then tap Resume.</p>
              <ul className="mt-2 space-y-2">
                {state.reviewPlans.slice(0, 200).map((p) => (
                  <li key={p.planId} className="text-ui-base text-ink">
                    <Link className="inline-flex min-h-tap items-center font-semibold text-brand-700 underline" href={`/c/${p.customerId}`}>
                      {p.name}
                    </Link>
                    {p.review.length ? <span className="block text-ui-sm">{p.review.join(' ')}</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {state.needsALook.length ? (
            <details className="rounded-ui border border-surface-line p-3">
              <summary className="min-h-tap cursor-pointer text-ui-base font-semibold text-ink">Needs a look ({state.needsALook.length})</summary>
              <ul className="mt-2 space-y-1 text-ui-base text-ink">
                {state.needsALook.map((i) => (
                  <li key={i.id}>
                    <b>{KIND_WORDS[i.kind] ?? i.kind}:</b> {i.label} — {i.undo_note ?? i.error ?? i.problems?.[0]?.message ?? i.status}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {run.status === 'done' ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                if (
                  !(await confirmDialog({
                    title: 'Undo this whole import?',
                    description: 'Everything it added is removed, and anything it filled in is put back — except what someone has changed or used since, which is kept and listed.',
                    confirmLabel: 'Undo import',
                    destructive: true,
                  }))
                )
                  return
                onContinue('undo')
              }}
            >
              Undo this import
            </Button>
          ) : null}
        </CardContent>
      </Card>
      {run.status === 'done' ? <FilesStep runId={run.id} onDone={onReload} /> : null}
    </>
  )
}

function FilesStep({ runId, onDone }: { runId: string; onDone: () => void }) {
  const [files, setFiles] = React.useState<File[]>([])
  const [matches, setMatches] = React.useState<FileMatch[]>([])
  const [customers, setCustomers] = React.useState<Array<{ id: string; name: string }>>([])
  const [picked, setPicked] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState<string | null>(null)

  async function choose(list: File[]) {
    setBusy('Matching file names to customers…')
    try {
      const r = await api<{ matches: FileMatch[]; customers: Array<{ id: string; name: string }> }>(`${BASE}/${runId}`, { action: 'matchFiles', names: list.map((f) => f.name) })
      setFiles(list)
      setMatches(r.matches)
      setCustomers(r.customers.sort((a, b) => a.name.localeCompare(b.name)))
      setPicked(Object.fromEntries(r.matches.map((m) => [m.fileName, m.customerId ?? ''])))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function upload() {
    const ids: string[] = []
    let failed = 0
    const todo = files.filter((f) => picked[f.name])
    for (let i = 0; i < todo.length; i++) {
      const f = todo[i]
      const m = matches.find((x) => x.fileName === f.name)
      setBusy(`Uploading ${i + 1} of ${todo.length}…`)
      try {
        const title = m?.title || f.name.replace(/\.[^.]+$/, '')
        ids.push(await uploadCustomerDocument(picked[f.name], f, { category: documentCategory(`${title} ${f.name}`), title, fallbackName: `document_${i + 1}` }))
      } catch (e) {
        failed += 1
        toast.error(`${f.name}: ${(e as Error).message}`)
      }
    }
    if (ids.length) await api(`${BASE}/${runId}`, { action: 'recordDocuments', documentIds: ids }).catch(() => null)
    setBusy(null)
    setFiles([])
    setMatches([])
    if (ids.length) toast.success(`${ids.length} file${ids.length === 1 ? '' : 's'} added to customers${failed ? `, ${failed} failed` : ''}`)
    onDone()
  }

  const ready = files.filter((f) => picked[f.name]).length
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contracts & files</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-ui-base text-ink">
          Jobber only lets you download files one client at a time (open the client → Files and media → Select all → download). Name them “Client Name - Contract.pdf” and drop them here: we match each one to a customer and you check before anything is saved.
        </p>
        <FileDropZone onFiles={choose} disabled={!!busy} label="Drop files here or tap to choose" hint="PDFs, photos, documents — any number" />
        {busy ? <p role="status" className="text-ui-base font-semibold text-ink">{busy}</p> : null}
        {matches.length ? (
          <>
            <ul className="divide-y divide-surface-line rounded-ui border border-surface-line">
              {matches.map((m) => (
                <li key={m.fileName} className="space-y-1 p-3">
                  <p className="break-all text-ui-base font-semibold text-ink">
                    {m.fileName} {m.how === 'close' ? <Badge tone="warning">Check</Badge> : null}
                  </p>
                  <Select aria-label={`Customer for ${m.fileName}`} value={picked[m.fileName] ?? ''} onChange={(e) => setPicked((p) => ({ ...p, [m.fileName]: e.target.value }))}>
                    <option value="">Don’t add this file</option>
                    {m.candidates.length ? (
                      <optgroup label="Best matches">
                        {m.candidates.map((c) => (
                          <option key={`b-${c.id}`} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    <optgroup label="All customers">
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  </Select>
                </li>
              ))}
            </ul>
            <Button className="w-full" disabled={!ready || !!busy} onClick={upload}>
              Add {ready} file{ready === 1 ? '' : 's'} to customers
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

function PastImports({ runs }: { runs: Run[] }) {
  if (!runs.length) return null
  const words: Record<string, string> = { done: 'Brought over', undone: 'Undone', importing: 'Running', undoing: 'Undoing', draft: 'Not started' }
  return (
    <details className="rounded-ui border border-surface-line bg-surface p-3">
      <summary className="min-h-tap cursor-pointer text-ui-base font-semibold text-ink">Earlier imports ({runs.length})</summary>
      <ul className="mt-2 space-y-1 text-ui-base text-ink">
        {runs.map((r) => (
          <li key={r.id}>
            {formatDate(r.created_at)} — {words[r.status] ?? r.status}
          </li>
        ))}
      </ul>
    </details>
  )
}
