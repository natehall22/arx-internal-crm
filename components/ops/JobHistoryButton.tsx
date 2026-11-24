'use client'

import * as React from 'react'

import { Button, Dialog, DialogContent, DialogFooter } from '@/components/ui'
import { formatDateShort, formatDateTime } from '@/lib/format'

type Entry = { id: string; at: string; by: string | null; lines: string[]; note: string | null }

/**
 * "History" on the job page: who changed what, and when (newest first). A modal on desktop, a bottom sheet on a phone
 * (the shared Dialog). Read-only; the list comes from GET /api/ops/jobs/[id]/history.
 */
export default function JobHistoryButton({ jobId, className }: { jobId: string; className?: string }) {
  const [open, setOpen] = React.useState(false)
  const [entries, setEntries] = React.useState<Entry[] | null>(null)
  const [page, setPage] = React.useState(0)
  const [hasMore, setHasMore] = React.useState(false)
  const [startsAt, setStartsAt] = React.useState<string | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [loading, setLoading] = React.useState(false)

  const load = React.useCallback(
    async (p: number) => {
      setLoading(true)
      setFailed(false)
      const res = await fetch(`/api/ops/jobs/${jobId}/history?page=${p}`, { cache: 'no-store' }).catch(() => null)
      setLoading(false)
      if (!res || !res.ok) {
        setFailed(true)
        return
      }
      const out = (await res.json().catch(() => ({}))) as { entries?: Entry[]; hasMore?: boolean; startsAt?: string; page?: number }
      setEntries((prev) => (p === 0 ? (out.entries ?? []) : [...(prev ?? []), ...(out.entries ?? [])]))
      setHasMore(!!out.hasMore)
      setPage(out.page ?? p)
      setStartsAt(out.startsAt ?? null)
    },
    [jobId]
  )

  function show() {
    setOpen(true)
    setEntries(null)
    void load(0)
  }

  return (
    <>
      <Button type="button" variant="secondary" size="sm" className={className ?? 'min-h-[44px]'} onClick={show}>
        History
      </Button>
      {open ? (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent title="Job history">
            {failed ? (
              <p className="text-ui-base text-ink">Could not load the history. Try again.</p>
            ) : entries === null ? (
              <p className="text-ui-base text-ink">Loading…</p>
            ) : entries.length === 0 && hasMore ? (
              <p className="text-ui-base text-ink">Nothing you can see in the newest changes. Show older to keep looking.</p>
            ) : entries.length === 0 ? (
              <p className="text-ui-base text-ink">No changes yet. History starts {formatDateShort(startsAt ?? new Date())}.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {entries.map((h) => (
                  <li key={h.id} className="text-ui-base text-ink">
                    <p className="font-semibold">
                      {formatDateTime(h.at)} · {h.by ?? 'Automatic'}
                    </p>
                    {h.lines.map((l, i) => (
                      <p key={i} className="break-words">{l}</p>
                    ))}
                    {h.note ? <p className="break-words">{h.note}</p> : null}
                  </li>
                ))}
              </ul>
            )}
            {hasMore ? (
              <Button type="button" variant="secondary" className="min-h-[44px]" loading={loading} onClick={() => void load(page + 1)}>
                Show older
              </Button>
            ) : null}
            <DialogFooter>
              <Button variant="secondary" className="min-h-[44px]" onClick={() => setOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
