'use client'

import { useEffect, useState } from 'react'

import { ClockNotices } from './ClockPanel'
import { clockTime, type Clock } from './useClock'

const btn = 'inline-flex min-h-[48px] items-center justify-center rounded-lg px-4 text-base font-semibold disabled:opacity-50'
const primary = `${btn} bg-[#2c2c2a] text-white`
const outline = `${btn} border-2 border-[#2c2c2a] bg-white text-[#2c2c2a]`

/** Re-render every half minute so the running time moves. */
function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(t)
  }, [everyMs])
  return now
}

/** "2:14" — hours and minutes since an instant (never negative: a phone a little behind shows 0:00). */
export function runningTime(startedAt: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60_000))
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`
}

/** Paid hours today so far for these people, as the server counted them (paid time rule; breaks out). Undefined servers count 0. */
export function paidDayHours(people: Array<{ paidTodaySeconds?: number }>): number {
  return Math.round((people.reduce((a, p) => a + (p.paidTodaySeconds ?? 0), 0) / 3600) * 100) / 100
}

function hoursLabel(hours: number): string {
  const mins = Math.round(hours * 60)
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`
}

/**
 * The day clock: ONE huge round button — green “Start day”, then red “End day” with the running time — and a smaller
 * Break toggle. Pay is the whole day (driving, loading, fuel, dump runs), so no stop has to be tapped. A crew lead starts
 * the day for the crew (everyone ticked; untick whoever isn’t working) and ends it for all or one person; a signed-in
 * crew member starts and ends their own. Same taps, offline queue and rules as the stop clock (one clock system).
 * ONE home for the day clock: the crew phone page and Today / My day both render this. `viewerUserId` narrows the card to
 * that one person (an embedded "My day"); `onPaidHours` reports their paid hours today (union of day, stops and travel,
 * breaks out) whenever it changes, and the same number shows under the button.
 */
export function DayClockCard({
  clock,
  selected,
  setSelected,
  title = 'Day clock',
  viewerUserId = null,
  onPaidHours,
}: {
  clock: Clock
  selected: string[]
  setSelected: (ids: string[]) => void
  title?: string
  /** Show only this person (their own day). Omit for the whole roster the clock returned (a crew lead's crew). */
  viewerUserId?: string | null
  /** Paid hours today so far for the people shown (2 decimals). */
  onPaidHours?: (hours: number) => void
}) {
  const { state, tap, latestOnClock } = clock
  const now = useNow()
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [perPerson, setPerPerson] = useState(false)
  const shown = state ? (viewerUserId ? state.people.filter((p) => p.userId === viewerUserId) : state.people) : []
  const paidHours = paidDayHours(shown)
  useEffect(() => {
    if (onPaidHours && state) onPaidHours(paidHours)
  }, [onPaidHours, state, paidHours])
  if (!state || shown.length === 0) return null
  if (!state.ready) return <p className="rounded-lg border-2 border-[#2c2c2a] bg-white p-3 text-base">The time clock isn’t ready yet — ask the office.</p>
  const tz = state.timeZone
  const people = shown
  const multi = people.length > 1
  const onShift = people.filter((p) => !!p.shift)
  const idle = people.filter((p) => !p.shift)
  const onClock = people.filter((p) => p.shift || p.open)
  const anyBreak = onClock.some((p) => p.onBreak)
  const everyBreak = onClock.length > 0 && onClock.every((p) => p.onBreak)
  const started = onShift.length > 0
  const earliest = onShift.reduce<string | null>((a, p) => (!a || p.shift!.startedAt < a ? p.shift!.startedAt : a), null)
  const startIds = selected.filter((id) => idle.some((p) => p.userId === id))
  const late = onShift.some((p) => p.shiftLate)

  const endDay = async (ids?: string[]) => {
    setConfirmEnd(false)
    setPerPerson(false)
    // Fresh list of who is on the clock: a stale screen must not leave anyone's day running.
    const fresh = ids ?? (viewerUserId ? (await latestOnClock()).filter((id) => id === viewerUserId) : await latestOnClock())
    if (fresh.length) void tap('day_end', { userIds: fresh })
  }

  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-xl border-2 border-[#2c2c2a] bg-white p-4 text-[#2c2c2a]">
      <h2 className="text-lg font-bold">{title}</h2>
      <ClockNotices clock={clock} />

      {late ? (
        <p role="status" className="rounded-lg bg-[#fff4cc] px-3 py-2 text-base font-semibold">
          {`Still on the clock since ${clockTime(earliest!, tz)}. Done for the day? Tap End day. (It stops on its own soon, and you’ll be asked what time you finished.)`}
        </p>
      ) : null}

      <p className="text-center text-base">
        {started
          ? `${everyBreak ? 'On break' : 'Day started'} — ${onShift.length === people.length && multi ? 'whole crew' : onShift.map((p) => p.name).join(', ')}`
          : multi
            ? 'Day not started. Who’s working today?'
            : 'Day not started.'}
        {started && earliest ? ` · since ${clockTime(earliest, tz)}` : ''}
      </p>

      <div className="flex justify-center">
        {started ? (
          <button
            type="button"
            aria-label={`End day, running ${runningTime(earliest!, now)}`}
            className="flex h-44 w-44 flex-col items-center justify-center gap-1 rounded-full bg-red-700 text-white shadow-lg active:bg-red-800"
            onClick={() => setConfirmEnd(true)}
          >
            <span className="text-2xl font-extrabold">End day</span>
            <span className="text-xl font-semibold tabular-nums">{runningTime(earliest!, now)}</span>
          </button>
        ) : (
          <button
            type="button"
            aria-label={startIds.length ? `Start day${multi ? ` (${startIds.length})` : ''}` : 'Start day — tick who is working first'}
            className="flex h-44 w-44 flex-col items-center justify-center gap-1 rounded-full bg-green-800 text-white shadow-lg active:bg-green-900 disabled:opacity-50"
            disabled={startIds.length === 0}
            onClick={() => void tap('day_start', { userIds: startIds })}
          >
            <span className="text-2xl font-extrabold">Start day</span>
            {multi ? <span className="text-base font-semibold">{startIds.length ? `${startIds.length} on the crew` : 'Tick who’s working'}</span> : null}
          </button>
        )}
      </div>

      {confirmEnd ? (
        <div className="flex flex-col gap-2 border-t-2 border-[#e5e3dc] pt-3">
          <p className="text-base font-bold">{multi ? 'End the day for everyone on the clock?' : 'End your day?'}</p>
          <button type="button" className={`${btn} bg-red-700 text-white`} onClick={() => void endDay()}>
            Yes — end day
          </button>
          <button type="button" className={outline} onClick={() => setConfirmEnd(false)}>
            Cancel
          </button>
        </div>
      ) : null}

      {onClock.length > 0 ? (
        <button type="button" aria-pressed={everyBreak} className={outline} onClick={() => void tap(anyBreak ? 'break_end' : 'break_start', { userIds: anyBreak ? onClock.filter((p) => p.onBreak).map((p) => p.userId) : onClock.map((p) => p.userId) })}>
          {anyBreak ? 'Back from break' : 'Break'}
        </button>
      ) : null}

      {paidHours > 0 ? <p className="text-center text-base font-semibold">{`${multi ? 'Crew paid today' : 'Paid today so far'}: ${hoursLabel(paidHours)}`}</p> : null}

      {multi && (started || idle.length > 0) ? (
        <div className="flex flex-col gap-2">
          {started ? <p className="text-base font-semibold">{idle.length > 0 ? 'Tick who’s at the next stop · tick the rest to start their day' : 'Tick who’s at the next stop'}</p> : null}
          <div className="flex flex-wrap gap-2">
            {(started ? people : idle).map((p) => {
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
          {started && idle.length > 0 ? (
            <button type="button" className={primary} disabled={startIds.length === 0} onClick={() => void tap('day_start', { userIds: startIds })}>
              {startIds.length ? `Start day for ${startIds.length} more` : 'Tick who’s starting'}
            </button>
          ) : null}
        </div>
      ) : null}

      {multi && onShift.length > 1 ? (
        <div className="flex flex-col gap-2">
          <button type="button" className={outline} aria-expanded={perPerson} onClick={() => setPerPerson(!perPerson)}>
            {perPerson ? 'Close' : 'End day for one person'}
          </button>
          {perPerson
            ? onShift.map((p) => (
                <button key={p.userId} type="button" className={outline} onClick={() => void endDay([p.userId])}>
                  {`End day: ${p.name}`}
                </button>
              ))
            : null}
        </div>
      ) : null}
    </section>
  )
}
