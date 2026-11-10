/** @jest-environment node */
import { describePending, HANDOFF_LEAVE_AFTER_RUNS, handoffTarget, handoffView, isPermanentKnockFailure, withTimeout, type PendingCounts } from '@/lib/host-handoff'

const APP = 'https://crm.example.test'

describe('handoffTarget', () => {
  it('sends an old address to the same path and query on the configured one', () => {
    expect(handoffTarget({ currentUrl: 'https://old.example.test/canvass?lead=1', appUrl: APP })).toBe('https://crm.example.test/canvass?lead=1')
  })
  it('does nothing on the configured address (any case, trailing slash)', () => {
    expect(handoffTarget({ currentUrl: 'https://CRM.example.test/canvass', appUrl: `${APP}/` })).toBeNull()
  })
  it('does nothing without a usable app address', () => {
    expect(handoffTarget({ currentUrl: 'https://old.example.test/canvass', appUrl: undefined })).toBeNull()
    expect(handoffTarget({ currentUrl: 'https://old.example.test/canvass', appUrl: 'crm.example.test' })).toBeNull()
  })
  it('never fires in local development or on preview deployments', () => {
    expect(handoffTarget({ currentUrl: 'http://localhost:3000/canvass', appUrl: APP })).toBeNull()
    expect(handoffTarget({ currentUrl: 'http://127.0.0.1:3000/canvass', appUrl: APP })).toBeNull()
    expect(handoffTarget({ currentUrl: 'https://branch-x.example.test/canvass', appUrl: APP, vercelEnv: 'preview' })).toBeNull()
    expect(handoffTarget({ currentUrl: 'https://old.example.test/canvass', appUrl: APP, vercelEnv: 'production' })).not.toBeNull()
  })
  it('a different port is a different origin (its storage is separate)', () => {
    expect(handoffTarget({ currentUrl: 'https://crm.example.test:8443/canvass', appUrl: APP })).toBe('https://crm.example.test/canvass')
  })
})

describe('handoffView', () => {
  const none: PendingCounts = { knocks: 0, jobPhotos: 0, reportPhotos: 0, knocksNeedingAttention: 0, photosUnreadable: false }
  it('shows the link only after a count found nothing left', () => {
    expect(handoffView({ counts: null, flushing: false, online: true }).kind).toBe('checking')
    expect(handoffView({ counts: none, flushing: false, online: true }).kind).toBe('ready')
  })
  it('never offers the link while anything is unsent, online or not, sending or not', () => {
    for (const counts of [{ ...none, knocks: 1 }, { ...none, jobPhotos: 1 }, { ...none, reportPhotos: 1 }]) {
      for (const flushing of [true, false]) {
        for (const online of [true, false]) {
          expect(handoffView({ counts, flushing, online }).kind).not.toBe('ready')
        }
      }
    }
  })
  it('says what is left and whether it is waiting for signal', () => {
    const v = handoffView({ counts: { ...none, knocks: 3, jobPhotos: 1, reportPhotos: 1 }, flushing: false, online: false })
    expect(v).toMatchObject({ kind: 'stuck', pending: 5, detail: '3 knocks, 2 photos', offline: true, canLeave: false })
    expect(handoffView({ counts: { ...none, knocks: 1 }, flushing: true, online: true })).toEqual({ kind: 'sending', pending: 1, detail: '1 knock' })
  })
  it('describePending', () => {
    expect(describePending({ knocks: 0, jobPhotos: 0, reportPhotos: 1 })).toBe('1 photo')
  })
})

describe('leaving with something left behind', () => {
  const none: PendingCounts = { knocks: 0, jobPhotos: 0, reportPhotos: 0, knocksNeedingAttention: 0, photosUnreadable: false }
  it('offers Continue anyway only after enough tries while online, and says what stays behind', () => {
    const counts = { ...none, knocks: 2 }
    expect(handoffView({ counts, flushing: false, online: true, failedRuns: HANDOFF_LEAVE_AFTER_RUNS - 1 })).toMatchObject({ kind: 'stuck', canLeave: false })
    expect(handoffView({ counts, flushing: false, online: true, failedRuns: HANDOFF_LEAVE_AFTER_RUNS })).toMatchObject({ kind: 'stuck', canLeave: true, leftBehind: '2 knocks' })
    // Offline is never "failed": the rep waits for signal.
    expect(handoffView({ counts, flushing: false, online: false, failedRuns: 99 })).toMatchObject({ canLeave: false })
  })
  it('refused knocks need attention, never block forever and are named in what stays behind', () => {
    const v = handoffView({ counts: { ...none, knocksNeedingAttention: 2 }, flushing: false, online: true })
    expect(v).toMatchObject({ kind: 'stuck', pending: 0, attention: '2 knocks', canLeave: true, leftBehind: '2 knocks' })
  })
  it('unreadable photo storage does not hang on Checking and lets the rep leave knowingly', () => {
    const v = handoffView({ counts: { ...none, photosUnreadable: true }, flushing: false, online: true })
    expect(v).toMatchObject({ kind: 'stuck', photosUnreadable: true, canLeave: true, leftBehind: 'any photos saved on this phone' })
  })
})

describe('isPermanentKnockFailure', () => {
  it('retries sign-out, timing and server errors; marks the rest', () => {
    for (const s of [400, 403, 404, 410, 413, 422]) expect(isPermanentKnockFailure(s)).toBe(true)
    for (const s of [401, 408, 425, 429, 500, 502, 503, 200]) expect(isPermanentKnockFailure(s)).toBe(false)
  })
})

describe('withTimeout', () => {
  it('rejects a promise that never settles (a blocked IndexedDB open)', async () => {
    jest.useFakeTimers()
    const p = withTimeout(new Promise(() => undefined), 5000)
    jest.advanceTimersByTime(5000)
    await expect(p).rejects.toThrow('timed out')
    jest.useRealTimers()
  })
  it('passes a value through', async () => {
    await expect(withTimeout(Promise.resolve(3), 1000)).resolves.toBe(3)
  })
})
