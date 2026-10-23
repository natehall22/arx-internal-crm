'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Preview = { count: number; oldest: string | null; newest: string | null; recentBatches: Array<{ batchId: string; closed: number; at: string; reverted: boolean }> }

/** Owner only: close out the old past appointments with no outcome (shows the count first, confirm, undo available). */
export default function CloseOutAppointments({ hidden }: { hidden: number }) {
  const router = useRouter()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = async () => {
    setBusy(true)
    setMsg('')
    try {
      const r = await fetch('/api/admin/appointments/closeout', { cache: 'no-store' })
      if (!r.ok) throw new Error('Could not load')
      setPreview(await r.json())
    } catch {
      setMsg('Could not load. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const post = async (body: unknown) => {
    setBusy(true)
    setMsg('')
    try {
      const r = await fetch('/api/admin/appointments/closeout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || 'Something went wrong')
      setMsg(j.closed != null ? `Closed out ${j.closed} appointment${j.closed === 1 ? '' : 's'}.` : `Restored ${j.restored}.`)
      setPreview(null)
      router.refresh()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-200 p-3" data-card="closeout">
      <p className="text-sm text-[#2c2c2a]">
        {hidden > 0 ? (
          <><b>{hidden} older appointment{hidden === 1 ? '' : 's'}</b> with no outcome are hidden from this list (more than 14 days old).</>
        ) : (
          <>No older appointments are waiting for an outcome.</>
        )}
      </p>
      {!preview ? (
        <button type="button" onClick={load} disabled={busy} className="mt-1 inline-flex min-h-[44px] items-center text-sm font-semibold text-[#2b0a3d] underline underline-offset-2">
          {hidden > 0 ? 'Close out old appointments…' : 'Close-out history / undo…'}
        </button>
      ) : (
        <div className="mt-2 flex flex-col gap-2 text-sm text-[#2c2c2a]">
          <p>
            This marks <b>{preview.count}</b> appointment{preview.count === 1 ? '' : 's'} (from {preview.oldest?.slice(0, 10)} to {preview.newest?.slice(0, 10)}) as <b>&ldquo;outcome not recorded&rdquo;</b>. They stay in the history, stop counting in sit/close rates, and you can undo it.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || preview.count === 0} onClick={() => post({ confirm: preview.count })} className="inline-flex min-h-[44px] items-center rounded-lg bg-[#2b0a3d] px-4 text-sm font-semibold text-white disabled:opacity-50">
              Close out {preview.count}
            </button>
            <button type="button" onClick={() => setPreview(null)} className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-300 px-4 text-sm font-semibold">Cancel</button>
          </div>
          {preview.recentBatches.filter((b) => !b.reverted).map((b) => (
            <button key={b.batchId} type="button" disabled={busy} onClick={() => post({ undoBatch: b.batchId })} className="inline-flex min-h-[44px] items-center text-left text-sm font-semibold underline underline-offset-2">
              Undo the batch of {b.closed} from {b.at.slice(0, 10)}
            </button>
          ))}
        </div>
      )}
      {msg ? <p role="status" className="mt-1 text-sm text-[#2c2c2a]">{msg}</p> : null}
    </div>
  )
}
