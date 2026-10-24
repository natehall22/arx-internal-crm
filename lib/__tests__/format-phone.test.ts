import { formatPhone, formatPhonesInText, telHref } from '@/lib/format'

describe('phone formatting', () => {
  it.each(['7049038092', '704-903-8092', '(704)903-8092', '+1 704 903 8092', '1-704-903-8092', '704.903.8092'])('formats %s', (v) => {
    expect(formatPhone(v)).toBe('(704) 903-8092')
  })
  it('leaves odd numbers as typed and empty as a dash', () => {
    expect(formatPhone('12345')).toBe('12345')
    expect(formatPhone('')).toBe('—')
    expect(formatPhone(null)).toBe('—')
  })
  it('builds a tel: link only when there is something to dial', () => {
    expect(telHref('(704) 903-8092')).toBe('tel:+17049038092')
    expect(telHref('1-704-903-8092')).toBe('tel:+17049038092')
    expect(telHref('')).toBeNull()
    expect(telHref('123')).toBeNull()
    expect(telHref('704-555-0142 x12')).toBeNull()
  })
  it('rewrites phones inside search subtitles', () => {
    expect(formatPhonesInText('1001 LYERLY RIDGE RD NW, CONCORD NC 28027 · (704)707-6274')).toBe('1001 LYERLY RIDGE RD NW, CONCORD NC 28027 · (704) 707-6274')
    expect(formatPhonesInText('(704)707-6274 · accepted')).toBe('(704) 707-6274 · accepted')
    expect(formatPhonesInText('Job 26-0026 · 28027')).toBe('Job 26-0026 · 28027')
  })
})
