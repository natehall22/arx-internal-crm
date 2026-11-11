'use client'

/**
 * The phone's time clock outbox (same pattern as the canvass offline store: Zustand + persist in localStorage, so a tap
 * made with no signal survives closing the page). Taps are sent IN ORDER per endpoint, each with the phone time it was
 * tapped (`at`) and the phone time it was sent (`deviceNow`) — the server uses the first and checks the second against
 * its own clock. Each tap has its own id, so a resend after a lost response changes nothing.
 *
 * A refusal retrying can't fix (`permanent: true`, or a 4xx other than 408 / 429) moves the tap to `failed` with the
 * server's words so the phone can show it; anything else (no signal, 5xx) stops the run and is tried again later.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type QueuedTap = { id: string; endpoint: string; body: Record<string, unknown>; queuedAt: string }
export type FailedTap = QueuedTap & { error: string }

type QueueState = {
  pending: QueuedTap[]
  failed: FailedTap[]
  sending: boolean
  lastSentAt: string | null
  enqueue: (endpoint: string, body: Record<string, unknown>) => string
  flush: () => Promise<void>
  dismissFailed: (id: string) => void
}

export function newTapId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : null
  if (c && 'randomUUID' in c) return c.randomUUID()
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

/** A response that retrying won't change. */
export function isPermanentRefusal(status: number, body: { permanent?: unknown } | null): boolean {
  if (body?.permanent === true) return true
  if (body?.permanent === false) return false
  return status >= 400 && status < 500 && status !== 408 && status !== 429 && status !== 401
}

export const useTimeClockQueue = create<QueueState>()(
  persist(
    (set, get) => ({
      pending: [],
      failed: [],
      sending: false,
      lastSentAt: null,
      enqueue: (endpoint, body) => {
        const id = typeof body.tapId === 'string' ? body.tapId : newTapId()
        set((s) => ({ pending: [...s.pending, { id, endpoint, body: { ...body, tapId: id }, queuedAt: new Date().toISOString() }] }))
        void get().flush()
        return id
      },
      flush: async () => {
        if (get().sending) return
        set({ sending: true })
        try {
          for (;;) {
            const next = get().pending[0]
            if (!next) break
            let res: Response | null = null
            try {
              res = await fetch(next.endpoint, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...next.body, deviceNow: new Date().toISOString() }),
              })
            } catch {
              res = null
            }
            if (!res) break // no signal: keep it, try later
            const out = (await res.json().catch(() => null)) as { error?: string; permanent?: unknown } | null
            if (res.ok) {
              set((s) => ({ pending: s.pending.filter((t) => t.id !== next.id), lastSentAt: new Date().toISOString() }))
              continue
            }
            if (isPermanentRefusal(res.status, out)) {
              set((s) => ({ pending: s.pending.filter((t) => t.id !== next.id), failed: [...s.failed, { ...next, error: out?.error || 'The office needs to fix this one.' }].slice(-20) }))
              continue
            }
            break // server trouble: keep the order, try later
          }
        } finally {
          set({ sending: false })
        }
      },
      dismissFailed: (id) => set((s) => ({ failed: s.failed.filter((t) => t.id !== id) })),
    }),
    { name: 'time-clock-queue', partialize: (s) => ({ pending: s.pending, failed: s.failed, lastSentAt: s.lastSentAt }) }
  )
)

if (typeof window !== 'undefined') {
  const nudge = () => void useTimeClockQueue.getState().flush()
  window.addEventListener('online', nudge)
  window.addEventListener('focus', nudge)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && nudge())
  window.setInterval(nudge, 30_000)
}
