import { readFileSync } from 'fs'
import { join } from 'path'

import { parseCsv } from '@/lib/csv'
import { customFieldLabel, defaultMapping, detectFileKind, mapRow, resolveMapping } from '@/lib/jobber-import/columns'
import { detectDateOrder, moneyCents, parseDate, parseLineItems, phoneDigits, splitJid, splitMulti, stateCode } from '@/lib/jobber-import/values'

const fx = (name: string) => parseCsv(readFileSync(join(__dirname, 'fixtures/jobber', name), 'utf8'))

describe('Jobber file detection', () => {
  it.each([
    ['clients-1.csv', 'clients'],
    ['invoices.csv', 'invoices'],
    ['recurring.csv', 'recurring_jobs'],
    ['visits.csv', 'visits'],
    ['quotes.csv', 'quotes'],
    ['products.csv', 'products'],
  ])('%s → %s', (file, kind) => {
    expect(detectFileKind(fx(file)[0])).toBe(kind)
  })
  it('a random CSV is not a Jobber export', () => {
    expect(detectFileKind(['Name', 'Email', 'Phone'])).toBeNull()
  })
})

describe('Jobber column mapping', () => {
  const headers = fx('clients-1.csv')[0]
  it('maps the real client export headers and keeps custom fields', () => {
    const m = defaultMapping('clients', headers)
    const t = (h: string) => m.find((x) => x.header === h)!
    expect(t('J-ID').target).toBe('jid')
    expect(t('Main Phone #s').target).toBe('main_phone')
    expect(t('E-mails').target).toBe('emails')
    expect(t('Service Zip code').target).toBe('service_zip')
    expect(t('CFS[Gate code]')).toMatchObject({ target: 'custom:customer', known: true, customLabel: 'Gate code' })
    expect(t('Receives automatic visit reminders?')).toMatchObject({ target: 'ignore', known: true })
    // A column nobody told us about: kept as a customer field, but flagged for the mapping screen.
    expect(t('Mowing height')).toMatchObject({ target: 'custom:customer', known: false })
  })
  it('owner choices win; a field chosen twice keeps the first', () => {
    const m = resolveMapping('clients', headers, { 'Mowing height': 'custom:property', 'Tags': 'emails' })
    expect(m.find((x) => x.header === 'Mowing height')!.target).toBe('custom:property')
    // E-mails comes before Tags, so Tags pointing at emails is dropped.
    expect(m.find((x) => x.header === 'Tags')!.target).toBe('ignore')
  })
  it('ignores choices that are not offered for the kind', () => {
    const m = resolveMapping('invoices', fx('invoices.csv')[0], { Subject: 'custom:customer' })
    expect(m.find((x) => x.header === 'Subject')!.target).toBe('subject')
  })
  it('mapRow splits fields, custom values and notes', () => {
    const m = resolveMapping('clients', headers, { Tags: 'note' })
    const r = mapRow(m, fx('clients-1.csv')[1])
    expect(r.fields.display_name).toBe('Jane Smith')
    expect(r.custom).toEqual(expect.arrayContaining([{ entity: 'customer', label: 'Gate code', value: '4421' }]))
    expect(r.notes).toEqual(['Tags: Weekly; VIP'])
  })
  it('custom field label', () => {
    expect(customFieldLabel('CFT[Referred By]')).toBe('Referred By')
    expect(customFieldLabel('Referred By')).toBeNull()
  })
})

describe('Jobber values', () => {
  it('money', () => {
    expect(moneyCents('$1,800.00')).toBe(180000)
    expect(moneyCents('(5.00)')).toBe(-500)
    expect(moneyCents('-$5')).toBe(-500)
    expect(moneyCents('')).toBeNull()
    expect(moneyCents('abc')).toBeNaN()
  })
  it('date order: a day over 12 proves it; all-low is ambiguous (read month/day)', () => {
    expect(detectDateOrder(['18/03/2025', '01/04/2025'])).toMatchObject({ order: 'dmy', ambiguous: false })
    expect(detectDateOrder(['03/18/2025'])).toMatchObject({ order: 'mdy', ambiguous: false })
    expect(detectDateOrder(['01/02/2025'])).toMatchObject({ order: 'mdy', ambiguous: true })
    expect(detectDateOrder(['18/03/2025', '03/18/2025'])).toMatchObject({ conflicting: true })
  })
  it('dates', () => {
    expect(parseDate('18/03/2025', 'dmy')).toBe('2025-03-18')
    expect(parseDate('03/18/2025', 'mdy')).toBe('2025-03-18')
    expect(parseDate('2025-03-18T10:00:00Z', 'mdy')).toBe('2025-03-18')
    expect(parseDate('Mar 18, 2025', 'dmy')).toBe('2025-03-18')
    expect(parseDate('31/02/2025', 'dmy')).toBeNull()
    expect(parseDate('', 'dmy')).toBeNull()
  })
  it('line items', () => {
    expect(parseLineItems('Weekly mowing (4, $180.00), Edging (1, $15.00)')).toEqual([
      { name: 'Weekly mowing', qty: 4, totalCents: 18000 },
      { name: 'Edging', qty: 1, totalCents: 1500 },
    ])
    expect(parseLineItems('Mulch (yard) (10, $450.00)')).toEqual([{ name: 'Mulch (yard)', qty: 10, totalCents: 45000 }])
    expect(parseLineItems('Soft wash house')).toBeNull()
    expect(parseLineItems('')).toEqual([])
  })
  it('multi values, phones, states, J-ID', () => {
    expect(splitMulti('+18505550101;8505550199')).toEqual(['+18505550101', '8505550199'])
    expect(phoneDigits('+1 (850) 555-0101')).toBe('8505550101')
    expect(phoneDigits('555-0101')).toBeNull()
    expect(stateCode('Florida')).toBe('FL')
    expect(stateCode('fl')).toBe('FL')
    expect(splitJid('101_201')).toEqual({ client: '101', property: '201' })
    expect(splitJid('103_')).toEqual({ client: '103', property: null })
  })
})
