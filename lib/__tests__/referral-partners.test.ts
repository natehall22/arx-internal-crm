import { csvToPartnerRows, parseCsv } from '@/lib/referral-partners-csv'
import {
  daysUntilOpen,
  normalizePartnerPhone,
  partnerTypeLabel,
  safeLikeTerm,
  type ReferralPartnerRow,
} from '@/lib/referral-partners'

const NOW = new Date('2026-10-20T12:00:00Z')
const partner = (over: Partial<ReferralPartnerRow>) =>
  ({
    status: 'assigned',
    last_touched_at: '2026-10-10T12:00:00Z',
    type: { id: 't', name: 'Real Estate Agent', inactivity_days: 30 },
    other_type_text: null,
    ...over,
  }) as ReferralPartnerRow

describe('daysUntilOpen', () => {
  it('counts down from the last touch using the type window', () => {
    expect(daysUntilOpen(partner({}), NOW)).toBe(20)
  })
  it('uses the longer window for builders', () => {
    const p = partner({ type: { id: 'b', name: 'Builder', inactivity_days: 90 } })
    expect(daysUntilOpen(p, NOW)).toBe(80)
  })
  it('never goes negative and is null when the partner cannot expire', () => {
    expect(daysUntilOpen(partner({ last_touched_at: '2026-01-01T00:00:00Z' }), NOW)).toBe(0)
    expect(daysUntilOpen(partner({ status: 'company_relationship' }), NOW)).toBeNull()
    expect(daysUntilOpen(partner({ status: 'open' }), NOW)).toBeNull()
  })
})

describe('normalizePartnerPhone', () => {
  it('matches the DB: digits only, leading US 1 dropped', () => {
    expect(normalizePartnerPhone('+1 (704) 555-0101')).toBe('7045550101')
    expect(normalizePartnerPhone('704.555.0101')).toBe('7045550101')
    expect(normalizePartnerPhone('')).toBeNull()
    expect(normalizePartnerPhone(null)).toBeNull()
  })
})

describe('partnerTypeLabel', () => {
  it('shows the typed text for Other', () => {
    expect(partnerTypeLabel(partner({ type: { id: 'o', name: 'Other', inactivity_days: 30 }, other_type_text: ' Title agent ' }))).toBe('Title agent')
    expect(partnerTypeLabel(partner({}))).toBe('Real Estate Agent')
  })
})

describe('safeLikeTerm', () => {
  it('strips characters that could break a PostgREST or() filter', () => {
    expect(safeLikeTerm('a,b)(c%_*"\\')).toBe('a b c')
  })
})

describe('csv import', () => {
  it('handles quoted commas and header aliases', () => {
    const rows = csvToPartnerRows('Full Name,Phone Number,Brokerage\n"Smith, Jo",704-555-0101,"Acme ""Realty"""\n\n')
    expect(rows).toEqual([{ name: 'Smith, Jo', phone: '704-555-0101', company: 'Acme "Realty"' }])
  })
  it('handles CRLF and a BOM', () => {
    expect(parseCsv('﻿name,phone\r\nA,1\r\nB,2')).toEqual([['name', 'phone'], ['A', '1'], ['B', '2']])
  })
})
