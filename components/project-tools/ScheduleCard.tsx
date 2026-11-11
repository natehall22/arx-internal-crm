'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { toast } from '@/components/ui/toast'
import { ymdLabel } from '@/lib/ymd-label'
import { addWorkdays, moveStage, nextWorkdayOnOrAfter, scheduleSpan } from '@/lib/job-schedule'
import type { StageView } from '@/lib/project-tools/stages-db'
import { confirmDialog } from '@/components/ui/confirm-dialog'
import { api, btnGhost, btnPrimary, Card, inputCls, Pill } from './ui'

type Payload = { stages: StageView[]; templates: Array<{ id: string; label: string; stageCount: number }>; ready: boolean; canEdit: boolean }

const DAY_PX = 14
const DAY_MS = 86400000
const parse = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))
const fmtDay = (ymd: string) => ymdLabel(ymd)
const addDays = (ymd: string, n: number) => new Date(parse(ymd) + n * DAY_MS).toISOString().slice(0, 10)
const todayYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/**
 * The job's stage schedule. First time: pick the template and a start date (2 taps) → dates fill in. After that a simple
 * timeline: drag a bar to a new date (or tap the stage and pick one) and everything that waits on it shifts with it.
 * It is the PLAN: booking the actual crew stays on the Crews card (existing install scheduling); a booked date shows under the stage.
 */
export default function ScheduleCard({ jobId }: { jobId: string }) {
  const [p, setP] = useState<Payload | null>(null)
  const [templateId, setTemplateId] = useState('')
  const [start, setStart] = useState(() => todayYmd())
  const [busy, setBusy] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ key: string; dx: number } | null>(null)
  const [adding, setAdding] = useState<{ name: string; workdays: string } | null>(null)
  const dragRef = useRef<{ key: string; x0: number; moved: boolean } | null>(null)

  const load = useCallback(async () => {
    const r = await api<Payload>(`/api/ops/jobs/${jobId}/schedule`)
    if (r.ok) {
      setP(r.data)
      setTemplateId((t) => t || r.data.templates[0]?.id || '')
    }
  }, [jobId])
  useEffect(() => void load(), [load])

  const stages = useMemo(() => p?.stages ?? [], [p])
  const span = useMemo(() => scheduleSpan(stages), [stages])
  // While dragging, preview the shift locally with the same rule the server uses.
  const preview = useMemo(() => {
    if (!drag) return null
    const st = stages.find((s) => s.key === drag.key)
    if (!st) return null
    const days = Math.round(drag.dx / DAY_PX)
    return moveStage(stages, drag.key, addDays(st.start, days)).stages
  }, [drag, stages])
  const shown = preview ?? stages
  if (!p) return null

  async function patch(body: Record<string, unknown>) {
    setBusy(true)
    const r = await api<{ clamped?: boolean }>(`/api/ops/jobs/${jobId}/schedule`, { method: 'PATCH', body: JSON.stringify(body) })
    setBusy(false)
    if (!r.ok) toast.error(r.data.error || 'Could not change the schedule')
    else if (r.data.clamped) toast('It cannot start before the stage it waits on ends.')
    await load()
  }
  async function build(replace = false) {
    setBusy(true)
    const r = await api(`/api/ops/jobs/${jobId}/schedule`, { method: 'POST', body: JSON.stringify({ templateId, start, replace }) })
    setBusy(false)
    if (!r.ok) return toast.error(r.data.error || 'Could not build the schedule')
    await load()
  }

  const rangeStart = span ? addDays(span.start, -2) : todayYmd()
  const rangeDays = span ? Math.max(14, Math.round((parse(span.end) - parse(rangeStart)) / DAY_MS) + 3) : 14

  function onDown(e: React.PointerEvent, key: string) {
    if (!p?.canEdit || busy) return
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    dragRef.current = { key, x0: e.clientX, moved: false }
    setDrag({ key, dx: 0 })
  }
  function onMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.x0
    if (Math.abs(dx) > 4) d.moved = true
    setDrag({ key: d.key, dx })
  }
  function onUp(e: React.PointerEvent) {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!d) return
    if (!d.moved) return setOpenKey((k) => (k === d.key ? null : d.key))
    const days = Math.round((e.clientX - d.x0) / DAY_PX)
    const st = stages.find((s) => s.key === d.key)
    if (!st || days === 0) return
    void patch({ action: 'move', key: d.key, start: addDays(st.start, days) })
  }


  return (
    <Card testId="schedule-card" title="Schedule" subtitle={span ? `${fmtDay(span.start)} to ${fmtDay(span.end)}` : 'Start from a template, then adjust.'}>
      {!p.ready ? <p className="text-base text-[#2c2c2a]">The schedule needs a database update first. Ask your admin to apply it.</p> : null}

      {p.ready && stages.length === 0 ? (
        <div className="space-y-2" data-testid="schedule-start">
          {p.templates.length > 0 ? (
            <>
              <label className="block text-sm font-semibold text-[#2c2c2a]">Template
                <select className={`${inputCls} mt-1`} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  {p.templates.map((t) => <option key={t.id} value={t.id}>{t.label} ({t.stageCount} stages)</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold text-[#2c2c2a]">First day
                <input type="date" className={`${inputCls} mt-1`} value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <button type="button" className={`${btnPrimary} w-full`} disabled={busy || !p.canEdit || !templateId || !start} onClick={() => void build()}>Build the schedule</button>
            </>
          ) : (
            <p className="text-base text-[#2c2c2a]">No template for your type of work yet. Add stages one by one.</p>
          )}
          {p.canEdit ? <button type="button" className={btnGhost} onClick={() => setAdding({ name: '', workdays: '3' })}>+ Add a stage</button> : null}
        </div>
      ) : null}

      {stages.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-[#d6d3ca]" data-testid="schedule-timeline">
          <div style={{ minWidth: rangeDays * DAY_PX + 140 }}>
            {shown.map((s) => {
              const orig = stages.find((x) => x.key === s.key) as StageView
              const left = Math.round((parse(s.start) - parse(rangeStart)) / DAY_MS) * DAY_PX
              const width = Math.max(DAY_PX, (Math.round((parse(addWorkdays(s.start, Math.max(1, s.workdays) - 1)) - parse(s.start)) / DAY_MS) + 1) * DAY_PX)
              const done = Boolean(orig.doneAt)
              const late = !done && addWorkdays(s.start, Math.max(1, s.workdays) - 1) < todayYmd()
              return (
                <div key={s.key} className="flex items-stretch border-b border-[#e5e3dc] last:border-b-0" data-testid="stage-row">
                  <div className="sticky left-0 z-10 flex w-[140px] shrink-0 flex-col justify-center bg-white px-2 py-1">
                    <span className="truncate text-sm font-semibold text-[#2c2c2a]">{s.name}</span>
                    <span className="text-sm text-[#2c2c2a]">{fmtDay(s.start)} · {s.workdays}d</span>
                  </div>
                  <div className="relative h-[60px] flex-1">
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`${s.name}, ${fmtDay(s.start)}. Drag to move, or tap to edit.`}
                      onPointerDown={(e) => onDown(e, s.key)}
                      onPointerMove={onMove}
                      onPointerUp={onUp}
                      onPointerCancel={() => { dragRef.current = null; setDrag(null) }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setOpenKey((k) => (k === s.key ? null : s.key)) }}
                      style={{ left, width, touchAction: 'pan-y' }}
                      className={`absolute top-2 flex h-11 items-center rounded-md border px-2 text-sm font-semibold ${done ? 'border-[#86efac] bg-[#dcfce7] text-[#14532d]' : late ? 'border-[#fca5a5] bg-[#fee2e2] text-[#7f1d1d]' : 'border-[#93c5fd] bg-[#dbeafe] text-[#1e3a8a]'} ${p.canEdit ? 'cursor-grab' : ''}`}
                    >
                      <span className="truncate">{done ? '✓ ' : ''}{s.name}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {stages.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {stages.filter((s) => openKey === s.key).map((s) => (
            <li key={`${s.key}-${s.start}-${s.workdays}`} className="space-y-2 rounded-lg bg-[#f1efe8] p-3" data-testid="stage-editor">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-base text-[#2c2c2a]">{s.name}</strong>
                {s.bookedDate ? <Pill tone={s.bookedDate === s.start ? 'green' : 'amber'}>Crew booked {fmtDay(s.bookedDate)}</Pill> : s.tradeName ? <Pill tone="gray">{s.tradeName}: no crew booked</Pill> : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm font-semibold text-[#2c2c2a]">Starts
                  <input type="date" className={`${inputCls} mt-1`} defaultValue={s.start} disabled={!p.canEdit || busy} onChange={(e) => e.target.value && void patch({ action: 'move', key: s.key, start: e.target.value })} />
                </label>
                <label className="block text-sm font-semibold text-[#2c2c2a]">Workdays
                  <input type="number" min={1} max={365} inputMode="numeric" className={`${inputCls} mt-1`} defaultValue={s.workdays} disabled={!p.canEdit || busy} onBlur={(e) => Number(e.target.value) !== s.workdays && void patch({ action: 'duration', key: s.key, workdays: Number(e.target.value) })} />
                </label>
              </div>
              <p className="text-sm text-[#2c2c2a]">
                Starts after: {s.dependsOn.length ? s.dependsOn.map((k) => stages.find((x) => x.key === k)?.name ?? k).join(', ') : 'nothing (can start any day)'}
              </p>
              {p.canEdit ? (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnGhost} disabled={busy} onClick={() => void patch({ action: 'done', key: s.key, done: !s.doneAt })}>{s.doneAt ? 'Not done' : 'Mark done'}</button>
                  <button type="button" className={btnGhost} disabled={busy} onClick={() => void patch({ action: 'remove', key: s.key }).then(() => setOpenKey(null))}>Remove stage</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {p.canEdit && stages.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={btnGhost} onClick={() => setAdding(adding ? null : { name: '', workdays: '3' })} aria-expanded={Boolean(adding)}>+ Add a stage</button>
          {p.templates.length > 0 ? <button type="button" className={btnGhost} disabled={busy} onClick={() => { void confirmDialog({ title: 'Start over from the template?', description: 'This replaces the dates below.', confirmLabel: 'Start over' }).then((ok) => { if (ok) void build(true) }) }}>Start over</button> : null}
        </div>
      ) : null}

      {adding ? (
        <div className="mt-3 space-y-2 rounded-lg border border-[#d6d3ca] p-3">
          <input className={inputCls} placeholder="Stage name" aria-label="Stage name" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
          <input className={inputCls} inputMode="numeric" placeholder="Workdays" aria-label="Workdays" value={adding.workdays} onChange={(e) => setAdding({ ...adding, workdays: e.target.value })} />
          <button type="button" className={`${btnPrimary} w-full`} disabled={busy || !adding.name.trim()} onClick={() => void patch({ action: 'add', name: adding.name, workdays: Number(adding.workdays) || 1, dependsOn: stages.length ? [stages[stages.length - 1].key] : [], start: stages.length ? undefined : nextWorkdayOnOrAfter(start) }).then(() => setAdding(null))}>Add stage</button>
        </div>
      ) : null}
      {stages.length > 0 ? <p className="mt-2 text-sm text-[#2c2c2a]">Drag a bar to move it; stages that wait on it move too.</p> : null}
    </Card>
  )
}
