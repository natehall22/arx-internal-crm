'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { newTapId, useTimeClockQueue } from '@/lib/time-clock-queue'
import type { ClockAction } from '@/lib/time-tracking'
import type { ClockPerson, ClockState } from '@/lib/time-tracking-db'

export type { ClockPerson, ClockState }

type Where = { workOrderId?: string | null; jobId?: string | null }

/** Wall-clock "7:02 AM" in the company's time zone. */
export function clockTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

/** The phone's location, only when the company asked for it — never waits more than a few seconds. */
function quickLocation(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  return new Promise((resolve) => {
    const done = (v: { lat: number; lng: number } | null) => resolve(v)
    const timer = setTimeout(() => done(null), 4000)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer)
        done({ lat: p.coords.latitude, lng: p.coords.longitude })
      },
      () => {
        clearTimeout(timer)
        done(null)
      },
      { maximumAge: 120_000, timeout: 3500, enableHighAccuracy: false }
    )
  })
}

/**
 * One clock (a crew phone link or the signed-in person): the state from the server, taps that go through the offline
 * queue, and an optimistic picture so the screen answers at once even with no signal.
 */
export function useClock(endpoint: string, opts: { tapperKey?: string; initial?: ClockState | null } = {}) {
  const [state, setState] = useState<ClockState | null>(opts.initial ?? null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const pending = useTimeClockQueue((s) => s.pending.filter((t) => t.endpoint === endpoint).length)
  const failed = useTimeClockQueue((s) => s.failed.filter((t) => t.endpoint === endpoint))
  const dismissFailed = useTimeClockQueue((s) => s.dismissFailed)
  const enqueue = useTimeClockQueue((s) => s.enqueue)

  const refresh = useCallback(async () => {
    if (useTimeClockQueue.getState().pending.some((t) => t.endpoint === endpoint)) return // keep the optimistic picture
    const res = await fetch(endpoint, { cache: 'no-store', credentials: 'include' }).catch(() => null)
    if (!res) return
    if (!res.ok) {
      setLoadError(res.status === 404 ? 'off' : 'Couldn’t load the clock')
      return
    }
    setLoadError(null)
    setState((await res.json()) as ClockState)
  }, [endpoint])

  useEffect(() => {
    if (!opts.initial) void refresh()
    void useTimeClockQueue.getState().flush()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint])

  // Another phone (or the office) may have tapped: re-read when this one comes back to the page.
  useEffect(() => {
    const onShow = () => document.visibilityState === 'visible' && void refresh()
    window.addEventListener('focus', onShow)
    document.addEventListener('visibilitychange', onShow)
    return () => {
      window.removeEventListener('focus', onShow)
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [refresh])

  // When the outbox empties, read the truth back from the server.
  const prevPending = useRef(pending)
  useEffect(() => {
    if (prevPending.current > 0 && pending === 0) void refresh()
    prevPending.current = pending
  }, [pending, refresh])

  // Who is tapping on a shared crew link: remembered on this phone; the only lead by default.
  const [tapper, setTapperState] = useState<string | null>(null)
  useEffect(() => {
    if (!opts.tapperKey || typeof window === 'undefined') return
    setTapperState(window.localStorage.getItem(`time-clock-tapper:${opts.tapperKey}`))
  }, [opts.tapperKey])
  const leads = useMemo(() => (state?.people ?? []).filter((p) => p.isLead), [state])
  const tappedBy = opts.tapperKey ? (tapper && state?.people.some((p) => p.userId === tapper) ? tapper : leads.length === 1 ? leads[0].userId : null) : null
  const setTapper = useCallback(
    (id: string) => {
      setTapperState(id)
      if (opts.tapperKey) window.localStorage.setItem(`time-clock-tapper:${opts.tapperKey}`, id)
    },
    [opts.tapperKey]
  )

  const tap = useCallback(
    async (action: ClockAction, extra: Where & { userIds?: string[]; forTravel?: boolean; pricebookItemId?: string; entryId?: string; finishTime?: string } = {}) => {
      const at = new Date().toISOString()
      const loc = state?.captureLocation ? await quickLocation() : null
      const body: Record<string, unknown> = { tapId: newTapId(), action, at, ...extra, ...(tappedBy ? { tappedBy } : {}), ...(loc ?? {}) }
      setState((s) => (s ? optimistic(s, action, extra, at) : s))
      enqueue(endpoint, body)
    },
    [endpoint, enqueue, state?.captureLocation, tappedBy]
  )

  return { state, loadError, pending, failed, dismissFailed, tap, refresh, tappedBy, setTapper, leads }
}

/** What the screen shows right after a tap, before the server answers. */
export function optimistic(s: ClockState, action: ClockAction, extra: Where & { userIds?: string[]; forTravel?: boolean; pricebookItemId?: string; entryId?: string }, at: string): ClockState {
  const picked = (p: ClockPerson) => !extra.userIds?.length || extra.userIds.includes(p.userId)
  switch (action) {
    case 'clock_in':
      return { ...s, people: s.people.map((p) => (picked(p) ? { ...p, open: { entryId: 'pending', workOrderId: extra.workOrderId ?? null, jobId: extra.jobId ?? null, startedAt: p.open && sameWhere(p.open, extra) ? p.open.startedAt : at }, onBreak: false, travelling: false } : p)), equipment: s.equipment.filter((e) => e.workOrderId === (extra.workOrderId ?? null)) }
    case 'clock_out':
      return { ...s, people: s.people.map((p) => (picked(p) && p.open ? { ...p, open: null, onBreak: false, travelling: extra.forTravel === true } : p)), equipment: [] }
    case 'break_start':
      return { ...s, people: s.people.map((p) => (picked(p) && p.open ? { ...p, onBreak: true } : p)) }
    case 'break_end':
      return { ...s, people: s.people.map((p) => (picked(p) ? { ...p, onBreak: false } : p)) }
    case 'equipment_start': {
      const name = s.equipmentChoices.find((c) => c.id === extra.pricebookItemId)?.name ?? 'Equipment'
      const wo = s.people.find((p) => p.open)?.open?.workOrderId ?? null
      return { ...s, equipment: [...s.equipment, { entryId: `pending-${extra.pricebookItemId}`, name, workOrderId: wo, startedAt: at }] }
    }
    case 'equipment_stop':
      return { ...s, equipment: s.equipment.filter((e) => e.entryId !== extra.entryId) }
    case 'finish_answer':
      return { ...s, finishQuestions: s.finishQuestions.filter((q) => q.entryId !== extra.entryId) }
  }
}

function sameWhere(open: { workOrderId: string | null; jobId: string | null }, w: Where): boolean {
  return w.workOrderId ? open.workOrderId === w.workOrderId : open.jobId === (w.jobId ?? null) && !open.workOrderId
}

export type Clock = ReturnType<typeof useClock>

/** Who is ticked as "here today": everyone at first (untick whoever is absent), kept while the page is open. */
export function usePresence(clock: Clock): [string[], (ids: string[]) => void] {
  const [selected, setSelected] = useState<string[] | null>(null)
  const people = clock.state?.people
  useEffect(() => {
    if (selected === null && people && people.length) setSelected(people.map((p) => p.userId))
  }, [people, selected])
  return [selected ?? [], setSelected]
}
