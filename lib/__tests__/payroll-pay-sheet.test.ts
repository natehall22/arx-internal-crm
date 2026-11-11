/** @jest-environment node */
jest.mock('jspdf', () => jest.requireActual('jspdf/dist/jspdf.node.min.js'))
import { buildPaySheet, paySheetFilename, payTypeLabel, readPaySheetSettings, DEFAULT_PAY_SHEET } from '@/lib/payroll-pay-sheet'
import { buildPersonPaySheetPdf } from '@/lib/pdf/payroll-person-sheet'
import { zipSheets } from '@/lib/payroll-pay-sheet-server'
import type { PayWeekPerson } from '@/lib/payroll-pay-week'

const person: PayWeekPerson = {
  userId: 'u1', name: 'Nathan Hall', roleLabel: 'Owner', total: 2005.5, raw: 2005.5, hoursMissing: false,
  lines: [
    { kind: 'Commission', what: '26-0141 · 12 Elm St', math: '$20,000 × 7% closer = $1,400', amount: 1400, jobId: 'j1', participantRole: 'sales_rep', roleKey: 'sales_rep', customer: 'Ashley Gaines', address: '12 Elm St' },
    { kind: 'Commission', what: '26-0150 · 5 Oak Dr', math: '$21,000 × 6% = $1,260', amount: 1260, jobId: 'j2', participantRole: 'self_gen', roleKey: 'self_gen', customer: 'Sam Lee', address: '5 Oak Dr' },
    { kind: 'Commission', what: '26-0150', math: 'm', amount: 0, jobId: 'j2', participantRole: 'setter', roleKey: 'setter' },
    { kind: 'Adjustment', what: 'Advance repaid', math: 'x', amount: -500, adjustmentKind: 'advance_recovery' },
    { kind: 'Adjustment', what: 'Fix', math: 'x', amount: -154.5, adjustmentKind: 'fix' },
  ],
}
const week = { state: 'approved' as const, period: { payDate: '2026-11-13', weekStart: '2026-11-02', weekEnding: '2026-11-08' } } as never

describe('pay sheet model (golden)', () => {
  it('plain words, no math by default, running total, zero lines dropped', () => {
    const s = buildPaySheet(week, person, { labels: {}, showMath: false })
    expect(s).toEqual({
      person: 'Nathan Hall', payDate: '2026-11-13', weekStart: '2026-11-02', weekEnding: '2026-11-08', total: 2005.5, carried: 0, preview: false, showMath: false,
      rows: [
        { customer: 'Ashley Gaines', address: '12 Elm St', payType: 'Sales Commission', amount: 1400, running: 1400 },
        { customer: 'Sam Lee', address: '5 Oak Dr', payType: 'Self-Generated Sales Commission', amount: 1260, running: 2660 },
        { customer: '', address: '', payType: 'Advance Repaid', amount: -500, running: 2160 },
        { customer: '', address: '', payType: 'Adjustment', amount: -154.5, running: 2005.5 },
      ],
    })
  })
  it('a company label wins; math only when switched on; an open week is a preview', () => {
    const s = buildPaySheet({ ...week, state: 'draft' }, person, { labels: { sales_rep: 'Ownership Draw' }, showMath: true })
    expect(s.preview).toBe(true)
    expect(s.rows[0]).toMatchObject({ payType: 'Ownership Draw', math: '$20,000 × 7% closer = $1,400' })
    expect(payTypeLabel(person.lines[0], {})).toBe('Sales Commission')
  })
  it('a negative check says what is carried; settings read tolerantly', () => {
    expect(buildPaySheet(week, { ...person, raw: -40, total: 0, lines: [] }, { labels: {}, showMath: false }).carried).toBe(40)
    expect(readPaySheetSettings({ paySheet: { colors: { primary: 'red', accent: '#AE9346' }, showMath: 'yes', labels: { setter: ' Setter Pay ', 'bad key!': 'x' } } })).toEqual({
      colors: { ...DEFAULT_PAY_SHEET.colors, accent: '#AE9346' }, showMath: false, labels: { setter: 'Setter Pay' },
    })
  })
  it('file names', () => {
    expect(paySheetFilename('Nathan Hall', '2026-11-13')).toBe('Nathan_Hall_Pay_Sheet_2026-11-13.pdf')
    expect(paySheetFilename("Mary-Ann O'Neil Jr.", '2026-11-13')).toBe('Mary_Ann_O_Neil_Jr_Pay_Sheet_2026-11-13.pdf')
  })
})

describe('pay sheet PDF', () => {
  const colors = DEFAULT_PAY_SHEET.colors
  const text = (b: Buffer) => b.toString('latin1')
  it('is landscape letter; a preview carries the mark and the date, an approved sheet neither', () => {
    const approved = buildPersonPaySheetPdf(buildPaySheet(week, person, { labels: {}, showMath: false }), { companyName: 'Acme Exteriors', colors, logo: null, generatedOn: '2026-11-12' })
    const preview = buildPersonPaySheetPdf(buildPaySheet({ ...week, state: 'draft' }, person, { labels: {}, showMath: false }), { companyName: 'Acme Exteriors', colors, logo: null, generatedOn: '2026-11-12' })
    expect(text(approved).startsWith('%PDF')).toBe(true)
    expect(text(approved)).toMatch(/MediaBox \[0 0 792\.? 612\.?\]/)
    expect(text(approved)).toContain('Acme Exteriors')
    expect(text(approved)).toContain('Self-Generated Sales Commission')
    expect(text(approved)).toContain('TOTAL TO PAY')
    expect(text(approved)).not.toContain('PREVIEW')
    expect(text(approved)).not.toMatch(/7%|6%/)
    expect(text(preview)).toContain('PREVIEW - not final')
    expect(text(preview)).toContain('Preview made Nov 12, 2026')
  })
  it('the same sheet makes the same bytes; a long list adds pages', () => {
    const s = buildPaySheet(week, person, { labels: {}, showMath: false })
    const a = buildPersonPaySheetPdf(s, { companyName: 'Acme', colors, logo: null, generatedOn: '2026-11-12' })
    expect(text(a).replace(/\/ID \[[^\]]*\]/, '')).toBe(text(buildPersonPaySheetPdf(s, { companyName: 'Acme', colors, logo: null, generatedOn: '2026-11-12' })).replace(/\/ID \[[^\]]*\]/, ''))
    const many = { ...s, rows: Array.from({ length: 40 }, (_, i) => ({ customer: `C${i}`, address: 'A', payType: 'Sales Commission', amount: 10, running: 10 * (i + 1) })) }
    expect((text(buildPersonPaySheetPdf(many, { companyName: 'Acme', colors, logo: null, generatedOn: '2026-11-12' })).match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1)
  })
  it('zip: two people with one name do not overwrite each other', () => {
    const z = zipSheets([{ filename: 'A_Pay_Sheet_2026-11-13.pdf', pdf: Buffer.from('1') }, { filename: 'A_Pay_Sheet_2026-11-13.pdf', pdf: Buffer.from('2') }])
    expect(Buffer.from(z).toString('latin1')).toContain('A_Pay_Sheet_2026-11-13_2.pdf')
  })
})
