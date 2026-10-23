import { parsePaidCsv, reconcile, toCents, toMarkdown } from '@/lib/payroll-reconcile'

const crm = [{ weekEnding: '2026-10-21', people: [{ userId: 'a', name: 'Jordan Vale', total: 1234.56 }, { userId: 'b', name: 'Sam Closer', total: 800 }, { userId: 'c', name: 'Riley Ops', total: 0.1 + 0.2 }] }]

describe('payroll side-by-side', () => {
  it('works in whole cents: 0.1 + 0.2 is 30 cents, not 30.000000000000004', () => {
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents(1234.56)).toBe(123456)
  })

  it('lists every difference to the cent, biggest first, including people on only one side', () => {
    const paid = parsePaidCsv('person,week_ending,paid\nJordan Vale,2026-10-21,"$1,234.55"\nsam closer,2026-10-21,800.00\nTaylor New,2026-10-21,150')
    const d = reconcile(crm, paid)
    expect(d.map((x) => [x.person, x.kind, x.diffCents])).toEqual([
      ['Taylor New', 'only_paid', -15000],
      ['Jordan Vale', 'differs', 1],
      ['Riley Ops', 'only_in_crm', 30],
      ['Sam Closer', 'match', 0],
    ].sort((a, b) => Math.abs(b[2] as number) - Math.abs(a[2] as number) || String(a[0]).localeCompare(String(b[0]))))
    expect(d.find((x) => x.person === 'Jordan Vale')!.diffCents).toBe(1)
  })

  it('two checks for one person in a week are summed', () => {
    const paid = parsePaidCsv('person,week_ending,paid\nSam Closer,2026-10-21,500\nSam Closer,2026-10-21,300')
    const sam = reconcile(crm, paid).find((x) => x.person === 'Sam Closer')!
    expect(sam.kind).toBe('match')
  })

  it('a week with no paid rows shows everyone as only in the CRM; the report states the net', () => {
    const d = reconcile(crm, [])
    expect(d.every((x) => x.kind === 'only_in_crm')).toBe(true)
    expect(toMarkdown(d)).toContain('3 differ')
  })

  it('rejects a bad CSV loudly instead of guessing', () => {
    expect(() => parsePaidCsv('who,when\nA,B')).toThrow(/needs columns/)
    expect(() => parsePaidCsv('person,week_ending,paid\nA,2026-10-21,abc')).toThrow(/not an amount/)
  })
})
