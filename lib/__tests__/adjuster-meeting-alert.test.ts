import { createFakeDb } from '@/lib/test-helpers/fake-db'

const sendMail = jest.fn()
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => { throw new Error('tests pass a client') } }))

jest.mock('@/lib/setter-email', () => ({
  getMailTransport: jest.fn(() => ({ sendMail })),
  getCrmEmailFrom: jest.fn(() => 'crm@arxroofing.com'),
}))

import {
  adjusterMeetingAlertEmailTo,
  buildAdjusterMeetingAlertHtml,
  buildAdjusterMeetingAlertSubject,
  buildAdjusterMeetingAlertText,
  formatAlertMeetingTime,
  sendAdjusterMeetingSyncAlert,
  shouldSendAdjusterMeetingAlert,
} from '@/lib/adjuster-meeting-alert'

// The live example: Saturday 8am ET, stored as noon UTC.
const SATURDAY_8AM_ET_AS_UTC = '2026-08-08T12:00:00.000Z'

const ORG = 'eeeeeeee-0000-4000-8000-000000000001'
const OTHER = 'eeeeeeee-0000-4000-8000-000000000002'
const db = () =>
  createFakeDb({
    users: [
      { id: 'o-new', org_id: ORG, role: 'admin', active: true, email: 'second@co.test', created_at: '2026-03-01T00:00:00Z' },
      { id: 'o-old', org_id: ORG, role: 'admin', active: true, email: 'owner@co.test', created_at: '2026-02-10T00:00:00Z' },
      { id: 'x', org_id: OTHER, role: 'admin', active: true, email: 'other@else.test', created_at: '2020-01-01T00:00:00Z' },
    ],
  }).client as never

const input = {
  orgId: ORG,
  appointmentId: '229e623a-8003-4f56-b823-8894d63657b6',
  customerName: 'Author Jones',
  address: '540 Acorn Oaks Dr, Salisbury, NC 28146',
  scheduledForIso: SATURDAY_8AM_ET_AS_UTC,
  attendeeName: 'Nathan Hall',
  bookedByName: 'Roda Temanil',
  error: 'The attending rep has not connected Google Calendar',
}

beforeEach(() => {
  sendMail.mockReset()
  sendMail.mockResolvedValue({ messageId: 'ok' })
  process.env.SMTP_HOST = 'smtp.example.com'
  delete process.env.ADJUSTER_MEETING_ALERT_EMAIL_TO
})

describe('recipient', () => {
  it("is the booking company's longest-standing active admin — never another company's, never a fixed inbox", async () => {
    expect(await adjusterMeetingAlertEmailTo(db(), ORG)).toBe('owner@co.test')
    process.env.ADJUSTER_MEETING_ALERT_EMAIL_TO = 'ops@elsewhere.test' // the retired global override is ignored
    expect(await adjusterMeetingAlertEmailTo(db(), ORG)).toBe('owner@co.test')
    expect(await adjusterMeetingAlertEmailTo(db(), 'no-such-company')).toBeNull()
  })

  it('a company with no active admin gets no email (no fallback inbox)', async () => {
    await expect(sendAdjusterMeetingSyncAlert({ ...input, orgId: 'no-such-company' }, db())).resolves.toEqual({
      sent: false,
      skippedReason: 'no_recipient',
    })
    expect(sendMail).not.toHaveBeenCalled()
  })
})

describe('Eastern time rendering — never raw UTC', () => {
  it('renders Saturday 8am ET, not 12:00 UTC', () => {
    const formatted = formatAlertMeetingTime(SATURDAY_8AM_ET_AS_UTC)
    expect(formatted).toContain('8:00 AM')
    expect(formatted).toContain('ET')
    expect(formatted).toContain('Sat')
    // The misleading UTC hour must not appear.
    expect(formatted).not.toContain('12:00')
  })

  it('never leaks the raw ISO string into the body', () => {
    const text = buildAdjusterMeetingAlertText(input)
    const html = buildAdjusterMeetingAlertHtml(input)
    expect(text).not.toContain(SATURDAY_8AM_ET_AS_UTC)
    expect(html).not.toContain(SATURDAY_8AM_ET_AS_UTC)
    expect(text).toContain('8:00 AM')
    expect(html).toContain('8:00 AM')
  })

  it('degrades safely on an unparseable timestamp', () => {
    expect(formatAlertMeetingTime('not-a-date')).toBe('Unknown time')
  })
})

describe('body content is enough to act on without opening the CRM', () => {
  it('includes customer, address, attendee, booker, error and appointment id', () => {
    const text = buildAdjusterMeetingAlertText(input)
    expect(text).toContain('Author Jones')
    expect(text).toContain('540 Acorn Oaks Dr')
    expect(text).toContain('Nathan Hall')
    expect(text).toContain('Roda Temanil')
    expect(text).toContain('has not connected Google Calendar')
    expect(text).toContain('229e623a-8003-4f56-b823-8894d63657b6')
    expect(text).toContain('Retry calendar sync')
  })

  it('makes clear the meeting is still booked', () => {
    expect(buildAdjusterMeetingAlertText(input)).toContain('IS booked in the CRM')
    expect(buildAdjusterMeetingAlertHtml(input)).toContain('is booked in the CRM')
  })

  it('distinguishes a first failure from a failing retry', () => {
    expect(buildAdjusterMeetingAlertSubject(input)).toContain('ACTION NEEDED')
    expect(buildAdjusterMeetingAlertSubject({ ...input, isRetry: true })).toContain('STILL FAILING')
  })

  it('escapes HTML so an error message cannot inject markup', () => {
    const html = buildAdjusterMeetingAlertHtml({
      ...input,
      error: '<script>alert(1)</script>',
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('uses explicit dark text, not low-contrast grey', () => {
    expect(buildAdjusterMeetingAlertHtml(input)).toContain('#2c2c2a')
  })
})

describe('anti-spam rule', () => {
  it('alerts when a failure is newly recorded', () => {
    expect(shouldSendAdjusterMeetingAlert({ alreadyFailing: false, isRetry: false })).toBe(true)
  })

  it('stays quiet for an already-known failure', () => {
    expect(shouldSendAdjusterMeetingAlert({ alreadyFailing: true, isRetry: false })).toBe(false)
  })

  it('always alerts on an explicit retry, even when already failing', () => {
    expect(shouldSendAdjusterMeetingAlert({ alreadyFailing: true, isRetry: true })).toBe(true)
    expect(shouldSendAdjusterMeetingAlert({ alreadyFailing: false, isRetry: true })).toBe(true)
  })
})

describe('sending never breaks the booking', () => {
  it('sends to the configured recipient on a failure', async () => {
    const result = await sendAdjusterMeetingSyncAlert(input, db())
    expect(result.sent).toBe(true)
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(sendMail.mock.calls[0][0]).toMatchObject({ to: 'owner@co.test' })
  })

  it('does not throw when the mail transport throws', async () => {
    sendMail.mockRejectedValue(new Error('SMTP down'))
    await expect(sendAdjusterMeetingSyncAlert(input, db())).resolves.toEqual({
      sent: false,
      skippedReason: 'send_failed',
    })
  })

  it('does not throw when the transport itself cannot be constructed', async () => {
    const { getMailTransport } = jest.requireMock('@/lib/setter-email')
    ;(getMailTransport as jest.Mock).mockImplementationOnce(() => {
      throw new Error('no transport')
    })
    await expect(sendAdjusterMeetingSyncAlert(input, db())).resolves.toEqual({
      sent: false,
      skippedReason: 'send_failed',
    })
  })

  it('skips quietly when SMTP is not configured', async () => {
    delete process.env.SMTP_HOST
    await expect(sendAdjusterMeetingSyncAlert(input, db())).resolves.toEqual({
      sent: false,
      skippedReason: 'smtp_not_configured',
    })
    expect(sendMail).not.toHaveBeenCalled()
  })
})
