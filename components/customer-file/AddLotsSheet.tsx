'use client'

import * as React from 'react'

import DevelopmentPicker from '@/components/customer-file/DevelopmentPicker'
import { Button, Dialog, DialogContent, DialogFooter, Field, FileDropZone, Textarea, toast } from '@/components/ui'
import { LOTS_BATCH, parseLots } from '@/lib/lots'

type Totals = { added: number; existed: number; jobsCreated: number; jobsSkipped: number; failed: Array<{ lot: string; error: string }> }

/**
 * Customer File → Properties → "Add lots": a builder's lots in one development from a pasted list or a CSV (drag and drop or
 * tap to choose). One lot per line (lot, address, city, state, ZIP — only the lot number is required). Optionally a job per lot
 * with the trades ticked. Sent in small batches with a progress line; a re-run only adds what is missing.
 */
export default function AddLotsSheet({
  customerId,
  developments,
  trades,
  canCreateJobs,
  onClose,
  onDone,
}: {
  customerId: string
  developments: string[]
  trades: Array<{ slug: string; label: string }>
  canCreateJobs: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [development, setDevelopment] = React.useState('')
  const [text, setText] = React.useState('')
  const [makeJobs, setMakeJobs] = React.useState(false)
  const [picked, setPicked] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = React.useState<Totals | null>(null)

  const parsed = React.useMemo(() => parseLots(text), [text])
  const ready = development.trim() !== '' && parsed.rows.length > 0 && (!makeJobs || picked.length > 0)

  async function readFile(files: File[]) {
    const f = files[0]
    if (!f) return
    if (f.size > 2_000_000) {
      toast.error('That file is too big for a lot list')
      return
    }
    setText(await f.text())
  }

  async function run() {
    const rows = parsed.rows
    const totals: Totals = { added: 0, existed: 0, jobsCreated: 0, jobsSkipped: 0, failed: [] }
    setBusy({ done: 0, total: rows.length })
    for (let i = 0; i < rows.length; i += LOTS_BATCH) {
      const batch = rows.slice(i, i + LOTS_BATCH)
      const res = await fetch(`/api/customers/${customerId}/lots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ development, rows: batch, trades: makeJobs ? picked : [], createJobs: makeJobs }),
      }).catch(() => null)
      const data = (res ? await res.json().catch(() => ({})) : {}) as Partial<Totals> & { error?: string }
      if (!res || !res.ok) {
        toast.error(`${data.error || 'Could not save'}${i > 0 ? ` — ${totals.added + totals.existed} lots were saved before this` : ''}. Run it again to finish; lots already added are skipped.`)
        setBusy(null)
        setResult(totals)
        onDone()
        return
      }
      totals.added += data.added ?? 0
      totals.existed += data.existed ?? 0
      totals.jobsCreated += data.jobsCreated ?? 0
      totals.jobsSkipped += data.jobsSkipped ?? 0
      totals.failed.push(...(data.failed ?? []))
      setBusy({ done: Math.min(i + LOTS_BATCH, rows.length), total: rows.length })
    }
    setBusy(null)
    setResult(totals)
    onDone()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent title="Add lots" description="A builder’s lots in one development. Only the lot number is required.">
        {result ? (
          <div className="flex flex-col gap-3 text-ui-base text-ink" data-testid="lots-result">
            <p className="font-semibold">
              {result.added} lot{result.added === 1 ? '' : 's'} added{result.existed ? `, ${result.existed} already on file` : ''}.
            </p>
            {result.jobsCreated || result.jobsSkipped ? (
              <p>
                {result.jobsCreated} job{result.jobsCreated === 1 ? '' : 's'} made{result.jobsSkipped ? `, ${result.jobsSkipped} lot${result.jobsSkipped === 1 ? '' : 's'} already had a job` : ''}.
              </p>
            ) : null}
            {result.failed.length > 0 ? (
              <ul className="list-disc pl-5">
                {result.failed.slice(0, 8).map((f) => (
                  <li key={f.lot}>
                    Lot {f.lot}: {f.error}
                  </li>
                ))}
                {result.failed.length > 8 ? <li>and {result.failed.length - 8} more</li> : null}
              </ul>
            ) : null}
            <DialogFooter className="sticky bottom-0 bg-surface pt-2">
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (ready && !busy) void run()
            }}
          >
            <DevelopmentPicker required value={development} onChange={setDevelopment} developments={developments} />
            <Field label="Lots" hint="One per line: lot, address, city, state, ZIP. A lot number alone is fine. Paste from a spreadsheet or drop a CSV below.">
              {(p) => <Textarea {...p} value={text} onChange={(e) => setText(e.target.value)} rows={6} className="text-base" placeholder={'1, 120 Oak Ridge Dr\n2, 124 Oak Ridge Dr\n3'} />}
            </Field>
            <FileDropZone compact multiple={false} accept=".csv,.txt,text/csv,text/plain" label="Drop a CSV here or tap to choose" onFiles={(f) => void readFile(f)} />
            {text.trim() ? (
              <div className="text-ui-base text-ink" data-testid="lots-preview">
                <p className="font-semibold">
                  {parsed.rows.length} lot{parsed.rows.length === 1 ? '' : 's'} ready
                  {parsed.rows[0] ? ` (first: lot ${parsed.rows[0].lot}${parsed.rows[0].address ? `, ${parsed.rows[0].address}` : ''})` : ''}
                </p>
                {parsed.problems.slice(0, 5).map((p) => (
                  <p key={p}>{p}</p>
                ))}
                {parsed.problems.length > 5 ? <p>and {parsed.problems.length - 5} more notes</p> : null}
              </div>
            ) : null}
            {canCreateJobs && trades.length > 0 ? (
              <fieldset className="flex flex-col gap-1">
                <label className="flex min-h-tap items-center gap-3 text-ui-base font-semibold text-ink">
                  <input type="checkbox" className="h-5 w-5" checked={makeJobs} onChange={(e) => setMakeJobs(e.target.checked)} />
                  Also make a job for each lot
                </label>
                {makeJobs ? (
                  <div className="flex flex-col pl-2">
                    <p className="text-ui-sm text-ink">Crews each lot needs (schedule each one when it is time):</p>
                    {trades.map((t) => (
                      <label key={t.slug} className="flex min-h-tap items-center gap-3 text-ui-base text-ink">
                        <input type="checkbox" className="h-5 w-5" checked={picked.includes(t.slug)} onChange={(e) => setPicked((c) => (e.target.checked ? [...c, t.slug] : c.filter((x) => x !== t.slug)))} />
                        {t.label}
                      </label>
                    ))}
                  </div>
                ) : null}
              </fieldset>
            ) : null}
            <DialogFooter className="sticky bottom-0 bg-surface pt-2">
              <Button type="button" variant="secondary" disabled={!!busy} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={!!busy} disabled={!ready}>
                {busy ? `Adding ${busy.done} of ${busy.total}…` : `Add ${parsed.rows.length || ''} lot${parsed.rows.length === 1 ? '' : 's'}`}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
