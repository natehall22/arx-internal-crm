/** @jest-environment node */
import { describePending, handoffTarget, handoffView } from '@/lib/host-handoff'

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
  const none = { knocks: 0, jobPhotos: 0, reportPhotos: 0 }
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
    const v = handoffView({ counts: { knocks: 3, jobPhotos: 1, reportPhotos: 1 }, flushing: false, online: false })
    expect(v).toEqual({ kind: 'stuck', pending: 5, detail: '3 knocks, 2 photos', offline: true })
    expect(handoffView({ counts: { knocks: 1, jobPhotos: 0, reportPhotos: 0 }, flushing: true, online: true })).toEqual({ kind: 'sending', pending: 1, detail: '1 knock' })
  })
  it('describePending', () => {
    expect(describePending({ knocks: 0, jobPhotos: 0, reportPhotos: 1 })).toBe('1 photo')
  })
})
