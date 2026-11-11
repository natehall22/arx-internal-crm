import { DEFAULT_CUSTOMER_MESSAGE_SETTINGS, sampleMessages } from '@/lib/customer-messages'
import { classifyInbound } from '@/lib/sms/keywords'
import { helpReply, smsWords, startReply, stopReply } from '@/lib/sms/compliance'
import { formatE164, last10, maskE164, normalizeUsPhone } from '@/lib/sms/phone'
import { countSegments, toGsmSafe } from '@/lib/sms/segments'

describe('phone numbers', () => {
  it.each([
    ['(850) 555-0100', '+18505550100'],
    ['850-555-0100', '+18505550100'],
    ['1 850 555 0100', '+18505550100'],
    ['+18505550100', '+18505550100'],
  ])('%s', (raw, want) => expect(normalizeUsPhone(raw)).toBe(want))

  it.each(['', '555-0100', '+44 7700 900123', '850-555-0100 ext 4', '911-555-0100', '000-000-0000', '(850) 111-0100', '5555555555', 'call me'])('refuses %s', (raw) => {
    expect(normalizeUsPhone(raw)).toBeNull()
  })
  it('null and undefined are null', () => {
    expect(normalizeUsPhone(null)).toBeNull()
    expect(normalizeUsPhone(undefined)).toBeNull()
  })
  it('formats, masks and trims', () => {
    expect(formatE164('+18505550100')).toBe('(850) 555-0100')
    expect(maskE164('+18505550100')).toBe('(850) ***-0100')
    expect(maskE164('nope')).toBeNull()
    expect(last10('+18505550100')).toBe('8505550100')
  })
})

describe('segments', () => {
  it('160 plain characters is one segment, 161 is two', () => {
    expect(countSegments('a'.repeat(160))).toMatchObject({ segments: 1, encoding: 'GSM-7' })
    expect(countSegments('a'.repeat(161))).toMatchObject({ segments: 2, encoding: 'GSM-7' })
    expect(countSegments('a'.repeat(306)).segments).toBe(2)
    expect(countSegments('a'.repeat(307)).segments).toBe(3)
  })
  it('one emoji or curly quote turns the whole text into the expensive alphabet', () => {
    expect(countSegments('a'.repeat(69) + '🙂')).toMatchObject({ encoding: 'UCS-2', segments: 2 })
    expect(countSegments('It’s fine')).toMatchObject({ encoding: 'UCS-2' })
    expect(countSegments(toGsmSafe('It’s fine — “ok”…'))).toMatchObject({ encoding: 'GSM-7' })
  })
  it('extended characters count twice', () => {
    expect(countSegments('['.repeat(80)).segments).toBe(1)
    expect(countSegments('['.repeat(81)).segments).toBe(2)
  })
  it('empty is zero', () => expect(countSegments('').segments).toBe(0))
})

describe('opt-out words', () => {
  it.each(['STOP', 'stop', 'Stop.', ' stop! ', 'QUIT', 'END', 'CANCEL', 'UNSUBSCRIBE', 'STOPALL', 'stop all', 'REVOKE', 'OPTOUT', 'opt out', 'Opt-Out', 'STOP 🙏'])('%s is a stop', (t) => {
    expect(classifyInbound(t)).toBe('stop')
  })
  it.each([
    'please stop texting me',
    'Stop texting',
    "don't text me again",
    'do not text me',
    'no more texts',
    'take me off your list',
    'remove me from the list',
    'I want to opt out',
    'unsubscribe me from these messages',
    'leave me alone',
    'stop sending me messages please',
  ])('%s is a plain-language opt-out', (t) => {
    expect(classifyInbound(t)).toBe('optout_phrase')
  })
  it.each([
    'can you stop by at 3?',
    'end of the month works',
    'Please cancel my appointment on Tuesday',
    'stop by tomorrow',
    "don't text me until after 5, I'm driving",
    'is the crew going to stop at my neighbor too',
    'thanks, that works',
    '',
  ])('%s is a normal message', (t) => {
    expect(classifyInbound(t)).toBe('message')
  })
  it('help and start', () => {
    expect(classifyInbound('HELP')).toBe('help')
    expect(classifyInbound('help!')).toBe('help')
    expect(classifyInbound('START')).toBe('start')
    expect(classifyInbound('unstop')).toBe('start')
  })
  it('wrong number', () => {
    expect(classifyInbound('wrong number')).toBe('wrong_number')
    expect(classifyInbound('Sorry you have the wrong number')).toBe('wrong_number')
  })
})

describe('company words', () => {
  const co = { name: 'Northwind Roofing & Exteriors of the Carolinas', phone: '(850) 555-0100', email: 'office@example.com', addressLine: "", website: "" } as never
  it('first text names the company and says how to stop; later ones do not repeat it', () => {
    expect(smsWords('We are on the way.', { first: true, namePrefix: 'Northwind' })).toBe('Northwind: We are on the way. Reply STOP to opt out.')
    expect(smsWords('We are on the way.', { first: false, namePrefix: 'Northwind' })).toBe('Northwind: We are on the way.')
  })
  it('answers to STOP / HELP / START are plain text and name the company', () => {
    for (const t of [stopReply(co), helpReply(co), startReply(co)]) {
      expect(t.startsWith('Northwind')).toBe(true)
      expect(countSegments(t).encoding).toBe('GSM-7')
    }
    expect(helpReply(co)).toContain('(850) 555-0100')
  })
  it('every message template stays at two segments or less with the opt-out line, even with a long company name', () => {
    const msgs = sampleMessages(co, DEFAULT_CUSTOMER_MESSAGE_SETTINGS as never, '2026-11-17')
    for (const [kind, m] of Object.entries(msgs)) {
      const c = countSegments(smsWords(m.sms.replace(/^[^:]*: /, ''), { first: true, namePrefix: 'Northwind Roofing & Exteriors of the Carolinas' }))
      expect({ kind, ...c, ok: c.segments <= 2 }).toMatchObject({ ok: true })
    }
  })
})
