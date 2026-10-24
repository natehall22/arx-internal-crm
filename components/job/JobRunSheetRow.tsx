'use client'

import Link from 'next/link'
import { useState } from 'react'

import { toast } from '@/components/ui/toast'

type Recipient = { email: string; name: string }

/** The crew run sheet as one white row: Open / Edit / Email. Email asks who first and only reaches this job's subs. */
export default function JobRunSheetRow({ jobId, canEdit }: { jobId: string; canEdit: boolean }) {
  const [choosing, setChoosing] = useState(false)
  const [recipients, setRecipients] = useState<Recipient[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const openEmail = async () => {
    setChoosing(true)
    setRecipients(null)
    try {
      const res = await fetch(`/api/ops/jobs/${jobId}/run-sheet/email`)
      const json = await res.json().catch(() => ({}))
      const list: Recipient[] = res.ok ? json.recipients ?? [] : []
      setRecipients(list)
      setPicked(list.map((r) => r.email))
    } catch {
      setRecipients([])
    }
  }

  const send = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/ops/jobs/${jobId}/run-sheet/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: picked }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not send')
      toast.success(`Run sheet sent to ${(json.sentTo as string[]).join(', ')}`)
      setChoosing(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send')
    } finally {
      setBusy(false)
    }
  }

  const btn = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-[#2c2c2a] hover:bg-gray-50'
  return (
    <div className="mb-3 rounded-xl border bg-white p-3 shadow-sm" data-testid="run-sheet-row">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span aria-hidden className="text-lg">📄</span>
        <div className="min-w-0 flex-1 basis-40">
          <p className="text-sm font-semibold text-[#2c2c2a]">Crew run sheet</p>
          <p className="text-sm text-[#2c2c2a]">One page for the crew.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/ops/jobs/${jobId}/run-sheet/pdf`} target="_blank" rel="noopener noreferrer" className={btn}>Open</a>
          <Link href={`/ops/jobs/${jobId}/sheets`} className={btn}>Edit</Link>
          {canEdit && <button type="button" onClick={() => void openEmail()} className={btn}>Email</button>}
        </div>
      </div>
      {choosing && (
        <div className="mt-3 border-t pt-3">
          {recipients === null ? (
            <p className="text-sm text-[#2c2c2a]">Looking up the crews…</p>
          ) : recipients.length === 0 ? (
            <p className="text-sm text-[#2c2c2a]">No crew on this job has an email on file. Open the PDF and send it yourself.</p>
          ) : (
            <>
              <p className="mb-2 text-sm font-medium text-[#2c2c2a]">Send the run sheet to:</p>
              <ul className="space-y-1">
                {recipients.map((r) => (
                  <li key={r.email}>
                    <label className="flex min-h-[44px] items-center gap-3 text-sm text-[#2c2c2a]">
                      <input
                        type="checkbox"
                        className="h-5 w-5"
                        checked={picked.includes(r.email)}
                        onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.email] : p.filter((x) => x !== r.email)))}
                      />
                      <span>{r.name} <span className="text-gray-600">({r.email})</span></span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={busy || picked.length === 0} onClick={() => void send()} className="inline-flex min-h-[44px] items-center rounded-lg bg-indigo-700 px-4 text-sm font-semibold text-white disabled:opacity-50">
                  {busy ? 'Sending…' : 'Send'}
                </button>
                <button type="button" onClick={() => setChoosing(false)} className={btn}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
