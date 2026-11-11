'use client'

import { useCallback, useEffect, useState } from 'react'

import { toast } from '@/components/ui/toast'
import { ymdLabel } from '@/lib/ymd-label'
import type { DailyLogView } from '@/lib/project-tools/daily-logs-db'
import DailyLogForm from './DailyLogForm'
import { api, btnGhost, btnPrimary, Card, Pill } from './ui'

const dayLabel = (ymd: string) => ymdLabel(ymd, { weekday: true })

/** Daily log on the job page: tap "Add today's log" → note + photos → Save (3 taps). Past logs below, each can be emailed to the customer. */
export default function DailyLogCard({ jobId, canEdit }: { jobId: string; canEdit: boolean }) {
  const [logs, setLogs] = useState<DailyLogView[] | null>(null)
  const [ready, setReady] = useState(true)
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await api<{ logs: DailyLogView[]; ready: boolean }>(`/api/ops/jobs/${jobId}/daily-logs`)
    if (r.ok) {
      setLogs(r.data.logs)
      setReady(r.data.ready)
    }
  }, [jobId])
  useEffect(() => void load(), [load])
  if (!logs) return null

  async function post(body: { note: string; photoIds: string[]; weather: string; sendSummary: boolean }): Promise<string | null> {
    const r = await api<{ log?: DailyLogView }>(`/api/ops/jobs/${jobId}/daily-logs`, { method: 'POST', body: JSON.stringify(body) })
    if (!r.ok) return r.data.error || 'Could not save the log'
    if (body.sendSummary && r.data.log) {
      const s = await api(`/api/ops/jobs/${jobId}/daily-logs/${r.data.log.id}/send`, { method: 'POST', body: '{}' })
      if (!s.ok) toast.error(s.data.error || 'Saved, but the summary was not sent')
      else toast.success('Saved and sent to the customer')
    }
    setOpen(false)
    void load()
    return null
  }
  async function sendSummary(id: string) {
    setSending(id)
    const s = await api<{ sentTo?: string }>(`/api/ops/jobs/${jobId}/daily-logs/${id}/send`, { method: 'POST', body: '{}' })
    setSending(null)
    if (!s.ok) return toast.error(s.data.error || 'Could not send')
    toast.success(`Sent to ${s.data.sentTo}`)
    void load()
  }

  return (
    <Card testId="daily-log-card" title="Daily log" subtitle="A note and photos from the day." action={<button type="button" className={btnPrimary} onClick={() => setOpen((o) => !o)} aria-expanded={open}>Add today’s log</button>}>
      {!ready ? <p className="text-base text-[#2c2c2a]">The daily log needs a database update first. Ask your admin to apply it.</p> : null}
      {open ? <div className="mb-4"><DailyLogForm photoBase={`/api/ops/jobs/${jobId}/photos`} post={post} canSendSummary={canEdit} /></div> : null}
      {logs.length === 0 && ready ? <p className="text-base text-[#2c2c2a]">No logs yet.</p> : null}
      <ul className="divide-y divide-[#e5e3dc]">
        {logs.map((l) => (
          <li key={l.id} className="py-3" data-testid="daily-log-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-base font-semibold text-[#2c2c2a]">{dayLabel(l.log_date)} · {l.author_name || (l.source === 'crew' ? 'Crew' : 'Office')}</span>
              {l.summary_sent_at ? <Pill tone="green">Sent to customer</Pill> : null}
            </div>
            {l.weather ? <p className="text-sm text-[#2c2c2a]">{l.weather}</p> : null}
            {l.note ? <p className="mt-1 whitespace-pre-wrap break-words text-base text-[#2c2c2a]">{l.note}</p> : null}
            {l.photo_ids.length > 0 ? <p className="text-sm text-[#2c2c2a]">{l.photo_ids.length} photo{l.photo_ids.length === 1 ? '' : 's'} (in Photos & files)</p> : null}
            {canEdit && !l.summary_sent_at ? <button type="button" className={`${btnGhost} mt-2`} disabled={sending === l.id} onClick={() => void sendSummary(l.id)}>Send summary to customer</button> : null}
          </li>
        ))}
      </ul>
    </Card>
  )
}
