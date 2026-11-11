'use client'

import { useState } from 'react'

import { clockTime, type Clock, type ClockPerson } from './useClock'

const btn = 'inline-flex min-h-[48px] items-center justify-center rounded-lg px-4 text-base font-semibold disabled:opacity-50'
const primary = `${btn} bg-[#2c2c2a] text-white`
const outline = `${btn} border-2 border-[#2c2c2a] bg-white text-[#2c2c2a]`

type Where = { workOrderId?: string | null; jobId?: string | null }

function isHere(p: ClockPerson, w: Where): boolean {
  if (!p.open) return false
  return w.workOrderId ? p.open.workOrderId === w.workOrderId : !!w.jobId && p.open.jobId === w.jobId
}

/**
 * The crew's clock at the top of the crew phone page (and of the job page card): failed / waiting taps, who is tapping,
 * "what time did you finish yesterday?", who is clocked in where, Lunch, Clock out, machines. Field UI: big targets,
 * dark text, one obvious button.
 */
export function ClockPanel({
  clock,
  selected,
  setSelected,
  placeLabel,
  title = 'Time clock',
}: {
  clock: Clock
  selected: string[]
  setSelected: (ids: string[]) => void
  /** Where an open clock is ("Stop 2 — 12 Oak St"); null = unknown here. */
  placeLabel: (open: NonNullable<ClockPerson['open']>) => string | null
  title?: string
}) {
  const { state, pending, failed, dismissFailed, tap, tappedBy, setTapper, leads } = clock
  const [confirmOut, setConfirmOut] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  if (!state || state.people.length === 0) return null
  if (!state.ready) return <p className="rounded-lg border-2 border-[#2c2c2a] bg-white p-3 text-base">The time clock isn’t ready yet — ask the office.</p>
  const tz = state.timeZone
  const open = state.people.filter((p) => p.open)
  const onBreak = open.length > 0 && open.every((p) => p.onBreak)
  const first = open.reduce<ClockPerson | null>((a, p) => (!a || (p.open!.startedAt < a.open!.startedAt) ? p : a), null)
  const where = first?.open ? placeLabel(first.open) : null
  const multi = state.people.length > 1
  const needTapper = leads.length > 1 && !tappedBy

  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-xl border-2 border-[#2c2c2a] bg-white p-4 text-[#2c2c2a]">
      <h2 className="text-lg font-bold">{title}</h2>

      {failed.map((f) => (
        <div key={f.id} role="alert" className="flex flex-col gap-2 rounded-lg border-2 border-red-700 bg-white p-3 text-base">
          <p className="font-semibold text-red-800">A tap didn’t go through: {f.error}</p>
          <button type="button" className={outline} onClick={() => dismissFailed(f.id)}>
            OK
          </button>
        </div>
      ))}
      {pending > 0 ? <p className="rounded-lg bg-[#fff4cc] px-3 py-2 text-base">{`${pending} tap${pending === 1 ? '' : 's'} waiting for signal — they’ll send on their own. Times are kept.`}</p> : null}

      {needTapper ? (
        <div className="flex flex-col gap-2">
          <p className="text-base font-semibold">Who’s using this phone?</p>
          <div className="grid grid-cols-2 gap-2">
            {leads.map((l) => (
              <button key={l.userId} type="button" className={outline} onClick={() => setTapper(l.userId)}>
                {l.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {state.finishQuestions.map((q) => (
        <form
          key={q.entryId}
          className="flex flex-col gap-2 rounded-lg bg-[#fff4cc] p-3"
          onSubmit={(e) => {
            e.preventDefault()
            const t = answers[q.entryId]
            if (t) void tap('finish_answer', { entryId: q.entryId, finishTime: t })
          }}
        >
          <label className="flex flex-col gap-1 text-base font-semibold">
            {`What time did ${q.name} finish on ${new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(q.startedAt))}?`}
            <span className="text-sm font-normal">{`The clock was left running, so it stopped at ${clockTime(q.stoppedAt, tz)}.`}</span>
            <input type="time" required className="min-h-[48px] rounded-lg border-2 border-[#2c2c2a] bg-white px-3 text-base" value={answers[q.entryId] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.entryId]: e.target.value })} />
          </label>
          <button type="submit" className={primary} disabled={!answers[q.entryId]}>
            Save finish time
          </button>
        </form>
      ))}

      {open.length === 0 ? (
        <>
          <p className="text-base">{state.people.some((p) => p.travelling) ? 'On the road to the next stop (drive time is paid). Clock in when you get there.' : multi ? 'Not clocked in. Who’s here today?' : 'Not clocked in.'}</p>
          {multi ? (
            <div className="flex flex-wrap gap-2">
              {state.people.map((p) => {
                const on = selected.includes(p.userId)
                return (
                  <button
                    key={p.userId}
                    type="button"
                    aria-pressed={on}
                    className={`${btn} border-2 ${on ? 'border-[#2c2c2a] bg-[#2c2c2a] text-white' : 'border-[#2c2c2a] bg-white text-[#2c2c2a] line-through'}`}
                    onClick={() => setSelected(on ? selected.filter((id) => id !== p.userId) : [...selected, p.userId])}
                  >
                    {on ? '✓ ' : ''}
                    {p.name}
                  </button>
                )
              })}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="text-base">
            <span className="font-bold">{onBreak ? 'At lunch' : 'Clocked in'}</span>
            {` — ${open.length === state.people.length && multi ? 'whole crew' : open.map((p) => p.name).join(', ')}`}
            {where ? ` at ${where}` : ''}
            {first?.open && first.open.entryId !== 'pending' ? ` since ${clockTime(first.open.startedAt, tz)}` : ''}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={outline} onClick={() => void tap(onBreak ? 'break_end' : 'break_start', { userIds: open.map((p) => p.userId) })}>
              {onBreak ? 'Back from lunch' : 'Lunch'}
            </button>
            <button type="button" className={primary} onClick={() => setConfirmOut(true)}>
              {multi ? 'Clock out crew' : 'Clock out'}
            </button>
          </div>
          {confirmOut ? (
            <div className="flex flex-col gap-2 border-t-2 border-[#e5e3dc] pt-3">
              <p className="text-base font-bold">{multi ? 'Clock out the crew?' : 'Clock out?'}</p>
              <button
                type="button"
                className={primary}
                onClick={() => {
                  setConfirmOut(false)
                  void tap('clock_out', { userIds: open.map((p) => p.userId) })
                }}
              >
                Yes — done for the day
              </button>
              <button
                type="button"
                className={outline}
                onClick={() => {
                  setConfirmOut(false)
                  void tap('clock_out', { userIds: open.map((p) => p.userId), forTravel: true })
                }}
              >
                Driving to the next stop
              </button>
              <button type="button" className={outline} onClick={() => setConfirmOut(false)}>
                Cancel
              </button>
            </div>
          ) : null}
        </>
      )}

      {state.equipment.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {state.equipment.map((e) => (
            <li key={e.entryId} className="flex items-center justify-between gap-2 rounded-lg bg-[#f7f6f2] px-3 py-2 text-base">
              <span>
                <span className="font-bold">{e.name}</span> running since {clockTime(e.startedAt, tz)}
              </span>
              <button type="button" className={outline} disabled={e.entryId.startsWith('pending')} onClick={() => void tap('equipment_stop', { entryId: e.entryId })}>
                Stop
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open.length > 0 && state.equipmentChoices.length > 0 ? (
        <div className="flex flex-col gap-2">
          <button type="button" className={outline} aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
            {moreOpen ? 'Close equipment list' : 'Equipment time'}
          </button>
          {moreOpen ? (
            <div className="grid grid-cols-1 gap-2">
              {state.equipmentChoices
                .filter((c) => !state.equipment.some((e) => e.name === c.name))
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={outline}
                    onClick={() => {
                      setMoreOpen(false)
                      void tap('equipment_start', { pricebookItemId: c.id })
                    }}
                  >
                    {`Start ${c.name}`}
                  </button>
                ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/**
 * The one button on a stop / job: "Clock in crew here", "Move crew here?" when the crew is clocked in somewhere else,
 * or a plain "Clocked in here" line.
 */
export function ClockHereButton({ clock, where, selected, selfOnly = false }: { clock: Clock; where: Where; selected: string[]; selfOnly?: boolean }) {
  const [confirmMove, setConfirmMove] = useState(false)
  const { state, tap } = clock
  if (!state || state.people.length === 0 || !state.ready) return null
  const here = state.people.filter((p) => isHere(p, where))
  const elsewhere = state.people.filter((p) => p.open && !isHere(p, where))
  const crewWord = state.people.length > 1 && !selfOnly ? 'crew' : null
  if (here.length > 0 && elsewhere.length === 0) {
    const since = here.reduce((a, p) => (p.open!.startedAt < a ? p.open!.startedAt : a), here[0].open!.startedAt)
    return <p className="col-span-2 rounded-lg bg-[#e8f3ea] px-3 py-2 text-base font-semibold">{`Clocked in here${here[0].open!.entryId === 'pending' ? '' : ` since ${clockTime(since, state.timeZone)}`}`}</p>
  }
  if (elsewhere.length > 0) {
    return confirmMove ? (
      <div className="col-span-2 flex flex-col gap-2">
        <p className="text-base font-bold">{crewWord ? 'Move the crew to this stop?' : 'Move your clock here?'}</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={outline} onClick={() => setConfirmMove(false)}>
            Cancel
          </button>
          <button
            type="button"
            className={primary}
            onClick={() => {
              setConfirmMove(false)
              void tap('clock_in', { ...where, userIds: [...elsewhere, ...here].map((p) => p.userId) })
            }}
          >
            {crewWord ? 'Move crew' : 'Move here'}
          </button>
        </div>
      </div>
    ) : (
      <button type="button" className={`${primary} col-span-2`} onClick={() => setConfirmMove(true)}>
        {crewWord ? 'Move crew here' : 'Move my clock here'}
      </button>
    )
  }
  // Only the people ticked as here (a solo person is always "here").
  const ids = crewWord ? selected.filter((id) => state.people.some((p) => p.userId === id)) : state.people.map((p) => p.userId)
  return (
    <button type="button" className={`${btn} col-span-2 bg-green-800 text-white`} disabled={ids.length === 0} onClick={() => void tap('clock_in', { ...where, userIds: ids })}>
      {crewWord ? (ids.length ? `Clock in crew here (${ids.length})` : 'Tick who’s here first') : 'Clock in'}
    </button>
  )
}
