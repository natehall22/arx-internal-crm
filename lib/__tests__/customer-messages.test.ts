import {
  DEFAULT_CUSTOMER_MESSAGE_SETTINGS,
  anyMessageOn,
  dayPhrase,
  describeMessages,
  dueStep,
  hourInZone,
  isQuietHour,
  messageKey,
  parseCustomerMessageSettingsPatch,
  readCustomerMessageSettings,
  renderInvoiceReminder,
  renderVisitReminder,
  sampleMessages,
  visitReminderTiming,
} from '@/lib/customer-messages'
import { mapsHref, renderCustomerEmail, websiteHref } from '@/lib/customer-email-layout'
import { isPermanentSmtpFailure, normalizeEmail } from '@/lib/customer-message-channels'
import { ymdInZone } from '@/lib/payroll-week-schedule'

const company = { name: 'Precision Maintenance', phone: '(850) 555-0100', email: 'office@precision.test', website: 'precision.test', addressLine: '12 Main St, Crawfordville, FL 32327' }
const ctx = { company, customerName: 'Jane Smith', unsubscribeUrl: 'https://acme.example.com/m/tok?stop=1' }

describe('settings', () => {
  it('nothing stored = every message off (ARX unchanged)', () => {
    const s = readCustomerMessageSettings(undefined)
    expect(s).toEqual(DEFAULT_CUSTOMER_MESSAGE_SETTINGS)
    expect(anyMessageOn(s)).toBe(false)
  })
  it('bad stored values fall back to defaults; days are sorted and de-duplicated', () => {
    const s = readCustomerMessageSettings({ visitReminder: 'yes', visitReminderDays: 9, quoteFollowUpDays: [7, 3, 3], invoiceReminderDays: [0, 500], quietStart: 25 })
    expect(s.visitReminder).toBe(false)
    expect(s.visitReminderDays).toBe(1)
    expect(s.quoteFollowUpDays).toEqual([3, 7])
    expect(s.invoiceReminderDays).toEqual([0, 7, 14])
    expect(s.quietStart).toBe(20)
  })
  it('patch: validates every key, refuses unknown keys and empty saves', () => {
    expect(parseCustomerMessageSettingsPatch({ customerMessages: { visitReminder: true, visitReminderDays: 2, invoiceReminderDays: [14, -3, 0] } })).toEqual({
      set: { visitReminder: true, visitReminderDays: 2, invoiceReminderDays: [-3, 0, 14] },
    })
    expect(parseCustomerMessageSettingsPatch({ customerMessages: { visitReminderDays: 0 } })).toHaveProperty('error')
    expect(parseCustomerMessageSettingsPatch({ customerMessages: { quoteFollowUpDays: [1, 2, 3, 4] } })).toHaveProperty('error')
    expect(parseCustomerMessageSettingsPatch({ customerMessages: { onTheWay: 'on' } })).toHaveProperty('error')
    expect(parseCustomerMessageSettingsPatch({ customerMessages: { sendTo: 'x' } })).toEqual({ error: 'Unknown setting: sendTo' })
    expect(parseCustomerMessageSettingsPatch({ customerMessages: {} })).toEqual({ error: 'Nothing to save' })
    expect(parseCustomerMessageSettingsPatch({ customerMessages: { visitNote: 'x'.repeat(201) } })).toHaveProperty('error')
  })
})

describe('keys (one row per key = never twice)', () => {
  it('a visit reminder is per customer per visit day, whatever the visits', () => {
    expect(messageKey.visitReminder('email', 'c1', '2026-11-20')).toBe('visit_reminder:email:c1:2026-11-20')
    expect(messageKey.visitReminder('sms', 'c1', '2026-11-20')).not.toBe(messageKey.visitReminder('email', 'c1', '2026-11-20'))
    expect(messageKey.visitDone('email', 'v1')).toBe('visit_done:email:v1')
    expect(messageKey.invoiceReminder('email', 'i1', -3)).toBe('invoice_reminder:email:i1:-3')
  })
})

describe('time (company time zone, quiet hours, DST)', () => {
  it('hour in zone across both DST changes (New York)', () => {
    // Spring forward 2026-03-08 02:00 EST → 03:00 EDT.
    expect(hourInZone(new Date('2026-03-08T06:30:00Z'), 'America/New_York')).toBe(1)
    expect(hourInZone(new Date('2026-03-08T07:30:00Z'), 'America/New_York')).toBe(3)
    expect(hourInZone(new Date('2026-03-07T12:30:00Z'), 'America/New_York')).toBe(7)
    expect(hourInZone(new Date('2026-03-08T12:30:00Z'), 'America/New_York')).toBe(8)
    // Fall back 2026-11-01 02:00 EDT → 01:00 EST.
    expect(hourInZone(new Date('2026-11-01T05:30:00Z'), 'America/New_York')).toBe(1)
    expect(hourInZone(new Date('2026-11-01T06:30:00Z'), 'America/New_York')).toBe(1)
    expect(hourInZone(new Date('2026-10-31T12:30:00Z'), 'America/New_York')).toBe(8)
    expect(hourInZone(new Date('2026-11-01T12:30:00Z'), 'America/New_York')).toBe(7)
  })
  it('midnight is 0, never 24', () => {
    expect(hourInZone(new Date('2026-06-01T04:00:00Z'), 'America/New_York')).toBe(0)
  })
  it('quiet hours wrap midnight; same start and end = never quiet', () => {
    const s = { quietStart: 20, quietEnd: 8 }
    expect([19, 20, 23, 0, 7, 8].map((h) => isQuietHour(h, s))).toEqual([false, true, true, true, true, false])
    expect(isQuietHour(3, { quietStart: 9, quietEnd: 9 })).toBe(false)
    expect([12, 13, 14].map((h) => isQuietHour(h, { quietStart: 13, quietEnd: 14 }))).toEqual([false, true, false])
  })
  it('the company day decides "tomorrow" (Pacific evening is still today there)', () => {
    const now = new Date('2026-11-12T03:00:00Z')
    expect(ymdInZone(now, 'America/Los_Angeles')).toBe('2026-11-11')
    expect(ymdInZone(now, 'America/New_York')).toBe('2026-11-11')
    expect(ymdInZone(now, 'Europe/London')).toBe('2026-11-12')
  })
  it('visit reminder timing: lead days, a same-day reminder only in the morning, never for the past', () => {
    expect(visitReminderTiming('2026-11-11', '2026-11-12', 1, 9)).toBe('ahead')
    expect(visitReminderTiming('2026-11-11', '2026-11-13', 1, 9)).toBeNull()
    expect(visitReminderTiming('2026-11-11', '2026-11-13', 2, 9)).toBe('ahead')
    expect(visitReminderTiming('2026-11-11', '2026-11-11', 1, 9)).toBe('today')
    expect(visitReminderTiming('2026-11-11', '2026-11-11', 1, 11)).toBeNull()
    expect(visitReminderTiming('2026-11-11', '2026-11-10', 1, 9)).toBeNull()
    // Across the spring-forward day: still exactly one day.
    expect(visitReminderTiming('2026-03-07', '2026-03-08', 1, 9)).toBe('ahead')
    expect(visitReminderTiming('2026-10-31', '2026-11-01', 1, 9)).toBe('ahead')
  })
  it('due step: the latest step reached, within the grace window only (old ones never fire, two never at once)', () => {
    expect(dueStep(2, [3, 7])).toBeNull()
    expect(dueStep(3, [3, 7])).toBe(3)
    expect(dueStep(5, [3, 7])).toBe(3)
    expect(dueStep(6, [3, 7])).toBeNull()
    expect(dueStep(7, [3, 7])).toBe(7)
    expect(dueStep(60, [3, 7])).toBeNull()
    expect(dueStep(-3, [-3, 0, 7])).toBe(-3)
    expect(dueStep(1, [0, 1])).toBe(1)
  })
  it('day phrase', () => {
    expect(dayPhrase('2026-11-11', '2026-11-11')).toBe('today')
    expect(dayPhrase('2026-11-11', '2026-11-12')).toBe('tomorrow')
    expect(dayPhrase('2026-11-11', '2026-11-14')).toBe('Saturday, November 14')
  })
})

describe('words (company brand only, every channel)', () => {
  it('visit reminder: date, window, what, note; one email for two properties; sms text too', () => {
    const m = renderVisitReminder(ctx, {
      today: '2026-11-11',
      day: '2026-11-12',
      visits: [
        { address: '1 Oak St', what: 'Weekly lawn care' },
        { address: '9 Pine Rd', what: 'Hedge trimming' },
      ],
      window: 'between 8 AM and 5 PM',
      note: 'Please leave gates unlocked.',
    })
    expect(m.subject).toBe('Reminder: we’ll see you tomorrow')
    for (const s of ['1 Oak St', '9 Pine Rd', 'Weekly lawn care', 'Hedge trimming', 'between 8 AM and 5 PM', 'Please leave gates unlocked.', 'Hi Jane,', 'Precision Maintenance']) {
      expect(m.text).toContain(s)
      expect(m.html).toContain(s)
    }
    expect(m.sms.startsWith('Precision Maintenance: ')).toBe(true)
    expect(m.html).toContain('Stop these automatic emails')
    expect(m.html).not.toMatch(/ARX/)
  })
  it('escapes customer-entered text', () => {
    const m = renderVisitReminder({ ...ctx, customerName: '<script>x' }, { today: '2026-11-11', day: '2026-11-12', visits: [{ address: '<b>1</b>', what: 'a"b' }], window: '', note: '' })
    expect(m.html).not.toContain('<script>')
    expect(m.html).toContain('&lt;b&gt;1&lt;/b&gt;')
  })
  it('invoice reminder: before / on / after the due date; pay button only with a link', () => {
    const before = renderInvoiceReminder(ctx, { invoiceNumber: 'INV-1', balanceCents: 12345, dueDay: '2026-11-14', daysPastDue: -3, payUrl: null })
    expect(before.text).toContain('is due on November 14')
    expect(before.html).not.toContain('Pay $')
    const late = renderInvoiceReminder(ctx, { invoiceNumber: 'INV-1', balanceCents: 12345, dueDay: '2026-11-04', daysPastDue: 7, payUrl: 'https://acme.example.com/pay/x' })
    expect(late.subject).toBe('Past due: invoice INV-1')
    expect(late.html).toContain('Pay $123.45')
    expect(late.html).toContain('https://acme.example.com/pay/x')
  })
  it('layout: footer has the postal address (maps link), phone (tap to call), website; only http(s) / tel links', () => {
    const { html, text } = renderCustomerEmail({ company, heading: 'H', paragraphs: ['p'], button: { label: 'Go', href: 'javascript:alert(1)' }, unsubscribeUrl: 'https://u.test/x' })
    expect(html).toContain(mapsHref(company.addressLine).replace(/&/g, '&amp;'))
    expect(html).toContain('tel:+18505550100')
    expect(html).toContain('https://precision.test/')
    expect(html).not.toContain('javascript:')
    expect(text).toContain('12 Main St, Crawfordville, FL 32327')
    expect(text).toContain('Stop these automatic emails: https://u.test/x')
    expect(websiteHref('')).toBe('')
    expect(websiteHref('www.x.com')).toBe('https://www.x.com/')
  })
  it('settings previews render every message with the company brand, and describe them in plain words', () => {
    const s = readCustomerMessageSettings({ visitReminder: true, visitWindow: 'between 8 and 5' })
    const samples = sampleMessages(company, s, '2026-11-11', 'Quote')
    expect(Object.keys(samples)).toHaveLength(5)
    for (const m of Object.values(samples)) expect(m.html).toContain('Precision Maintenance')
    const d = describeMessages(s)
    expect(d.visit_reminder).toMatch(/^The day before each visit/)
    expect(d.invoice_reminder).toContain('on the due date, 7 days after it and 14 days after it')
  })
})

describe('channel helpers', () => {
  it('normalizes addresses and refuses placeholders', () => {
    expect(normalizeEmail('  Jane@Example.COM ')).toBe('jane@example.com')
    expect(normalizeEmail('x@none.com')).toBeNull()
    expect(normalizeEmail('n/a')).toBeNull()
    expect(normalizeEmail('a b@c.d')).toBeNull()
    expect(normalizeEmail('Jane <jane@x.com>')).toBeNull()
  })
  it('only a 5xx on the recipient suppresses an address', () => {
    expect(isPermanentSmtpFailure({ code: 'EENVELOPE', responseCode: 550 })).toBe(true)
    expect(isPermanentSmtpFailure({ responseCode: 553 })).toBe(true)
    expect(isPermanentSmtpFailure({ responseCode: 421 })).toBe(false)
    expect(isPermanentSmtpFailure({ code: 'ECONNECTION' })).toBe(false)
    expect(isPermanentSmtpFailure(null)).toBe(false)
  })
})
