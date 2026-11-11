/** @jest-environment node */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { recordConsent } from '@/lib/sms/consent'

const ORG = 'org-a'
const PHONE = '+18505550100'
const mk = (consent: Array<Record<string, unknown>> = [], sup: Array<Record<string, unknown>> = []) =>
  createFakeDb({ customer_sms_consent: consent, customer_message_suppressions: sup }, { unique: { customer_message_suppressions: [['org_id', 'channel', 'address']] } })
const revoked = { id: 'r', org_id: ORG, phone_e164: PHONE, status: 'revoked', source: 'sms_stop', created_at: '2026-11-01T00:00:00Z' }
const grant = (source: 'quote_form' | 'web_form' | 'portal' | 'signing' | 'staff_phone' | 'sms_start') => ({ customerId: null, phone: PHONE, status: 'granted' as const, source, companyName: 'Alpha' })

describe('consent from a form never outranks an earlier STOP', () => {
  it.each(['quote_form', 'web_form', 'portal', 'signing'] as const)('%s after a revoke is refused', async (source) => {
    const db = mk([revoked])
    const r = await recordConsent(db.client as never, ORG, grant(source))
    expect(r).toMatchObject({ ok: false, optedOut: true })
    expect(db.tables.customer_sms_consent).toHaveLength(1)
  })
  it('refused while the number is on the opt-out list, even with no revoke row', async () => {
    const db = mk([], [{ org_id: ORG, channel: 'sms', address: PHONE, reason: 'unsubscribed' }])
    expect(await recordConsent(db.client as never, ORG, grant('quote_form'))).toMatchObject({ ok: false })
  })
  it('a form works on a fresh number; staff "said OK" and the person’s own START reopen after a revoke', async () => {
    expect((await recordConsent(mk().client as never, ORG, grant('quote_form'))).ok).toBe(true)
    expect((await recordConsent(mk([revoked]).client as never, ORG, grant('staff_phone'))).ok).toBe(true)
    expect((await recordConsent(mk([revoked]).client as never, ORG, grant('sms_start'))).ok).toBe(true)
  })
})
