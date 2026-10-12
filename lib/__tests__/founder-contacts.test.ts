/** @jest-environment node */
const sendMail = jest.fn()
jest.mock('@/lib/setter-email', () => ({
  getCrmEmailFrom: () => 'ARX <info@arxroofing.com>',
  getMailTransport: () => ({ sendMail }),
}))

import {
  founderContactsCsv,
  founderContactsDigestHtml,
  parseFounderContact,
  sendFounderContactsDigests,
  type FounderContactRow,
} from '@/lib/founder-contacts'

const row = (over: Partial<FounderContactRow>): FounderContactRow => ({
  id: 'r1',
  kind: 'realtor',
  name: 'Jane Agent',
  phone: '704-555-0100',
  email: null,
  company: 'Keller Williams',
  notes: null,
  created_at: '2026-10-13T18:05:00Z',
  emailed_at: null,
  ...over,
})

describe('parseFounderContact', () => {
  it('accepts a realtor with trimmed fields and blank optionals as null', () => {
    const r = parseFounderContact({ kind: 'realtor', name: '  Jane  ', phone: ' 704 ', email: '', notes: '  ' })
    expect(r).toEqual({ ok: true, value: { kind: 'realtor', name: 'Jane', phone: '704', email: null, company: null, notes: null } })
  })

  it('rejects missing name, bad kind, bad email, non-string and over-long fields', () => {
    expect(parseFounderContact({ kind: 'recruit', name: ' ' })).toEqual({ ok: false, error: 'Name is required' })
    expect(parseFounderContact({ kind: 'boss', name: 'x' }).ok).toBe(false)
    expect(parseFounderContact({ kind: 'recruit', name: 'x', email: 'nope' })).toEqual({ ok: false, error: 'Email looks wrong' })
    expect(parseFounderContact({ kind: 'recruit', name: 'x', email: 'a@b' }).ok).toBe(true) // typo'd domain still saves
    expect(parseFounderContact({ kind: 'recruit', name: 'x', phone: 7045550100 }).ok).toBe(false)
    expect(parseFounderContact({ kind: 'recruit', name: 'x', notes: 'a'.repeat(2001) }).ok).toBe(false)
    expect(parseFounderContact(null).ok).toBe(false)
  })
})

describe('CSV and email body', () => {
  it('quotes commas/quotes/newlines and neutralizes spreadsheet formulas', () => {
    const csv = founderContactsCsv([row({ name: 'Smith, "Bo"', notes: 'line1\nline2', company: '=HYPERLINK("x")' })])
    const [, line] = csv.split('\r\n')
    expect(line).toContain('"Smith, ""Bo"""')
    expect(line).toContain('"line1\nline2"')
    expect(line).toContain(`"'=HYPERLINK(""x"")"`)
    expect(founderContactsCsv([row({ phone: '+1 704-555-0100' })])).toContain(',+1 704-555-0100,')
    expect(founderContactsCsv([row({ notes: '+SUM(A1)' })])).toContain(`'+SUM(A1)`)
    expect(founderContactsCsv([row({ notes: '-1+1' })])).toContain(`'-1+1`) // short arithmetic is not a phone
    expect(founderContactsCsv([row({ phone: '(704) 555-0100' })])).toContain(',(704) 555-0100,')
    expect(line.startsWith('"Oct 13, 2026, 2:05 PM"')).toBe(true) // Eastern time
  })

  it('escapes HTML and groups by type', () => {
    const html = founderContactsDigestHtml(
      [row({ name: '<script>x</script>' }), row({ id: 'r2', kind: 'recruit', name: 'Rob Rep', notes: 'solar rep, 2 yrs' })],
      7,
      'Tuesday, October 13'
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('Real estate agents (1)')
    expect(html).toContain('Recruits (1)')
    expect(html).toContain('all 7 contacts')
  })
})
describe('sendFounderContactsDigests (per user)', () => {
  type R = FounderContactRow & { org_id: string; created_by: string | null }
  const stamped: string[][] = []
  function fakeDb(rows: R[], users: Array<{ id: string; email: string | null; active: boolean }>) {
    return {
      from: (table: string) => {
        if (table === 'users') return { select: () => ({ in: async () => ({ data: users, error: null }) }) }
        const f: Array<(r: R) => boolean> = []
        const q: Record<string, unknown> = {
          select: () => q,
          is: (c: string) => { f.push((r) => (r as Record<string, unknown>)[c] == null); return q },
          not: (c: string) => { f.push((r) => (r as Record<string, unknown>)[c] != null); return q },
          eq: (c: string, v: unknown) => { f.push((r) => (r as Record<string, unknown>)[c] === v); return q },
          order: () => q,
          range: async (from: number) => ({ data: from === 0 ? rows.filter((r) => f.every((fn) => fn(r))) : [], error: null }),
          update: () => ({ in: async (_c: string, ids: string[]) => { stamped.push(ids); return { error: null } } }),
        }
        return q
      },
    } as never
  }
  const r = (over: Partial<R>): R => ({ ...row({}), org_id: 'org-1', created_by: 'u1', ...over })

  beforeEach(() => { sendMail.mockReset().mockResolvedValue({}); stamped.length = 0; process.env.SMTP_HOST = 'smtp.test' })

  it('skips when nothing is new', async () => {
    const db = fakeDb([r({ emailed_at: '2026-10-12T01:00:00Z' })], [])
    expect(await sendFounderContactsDigests(db)).toEqual({ sent: 0, skipped: true, reason: 'nothing_new' })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('emails each person their own new contacts, CSV of all of theirs, then stamps only those', async () => {
    const db = fakeDb(
      [r({ id: 'a1' }), r({ id: 'a-old', emailed_at: '2026-10-12T01:00:00Z' }), r({ id: 'b1', created_by: 'u2', name: 'Rob' })],
      [{ id: 'u1', email: 'nathan@x.com', active: true }, { id: 'u2', email: 'rep@x.com', active: true }]
    )
    const res = await sendFounderContactsDigests(db, new Date('2026-10-14T01:00:00Z'))
    expect(res).toEqual({ sent: 2, skipped: false })
    const toNathan = sendMail.mock.calls.find((c) => c[0].to === 'nathan@x.com')![0]
    expect(toNathan.subject).toBe('ARX contacts — 1 new (Tuesday, October 13)')
    expect(toNathan.attachments[0].content.split('\r\n').filter(Boolean)).toHaveLength(3) // header + a1 + a-old
    expect(toNathan.html).not.toContain('Rob')
    expect(stamped.flat().sort()).toEqual(['a1', 'b1'])
  })

  it('one failed email does not block others, and its rows are not stamped', async () => {
    sendMail.mockImplementation(async (m: { to: string }) => { if (m.to === 'nathan@x.com') throw new Error('smtp down') })
    const db = fakeDb([r({ id: 'a1' }), r({ id: 'b1', created_by: 'u2' })],
      [{ id: 'u1', email: 'nathan@x.com', active: true }, { id: 'u2', email: 'rep@x.com', active: true }])
    expect(await sendFounderContactsDigests(db)).toEqual({ sent: 1, skipped: false })
    expect(stamped.flat()).toEqual(['b1'])
  })

  it('inactive users / no email: no email sent, rows marked handled so they are not reloaded nightly', async () => {
    const db = fakeDb([r({ id: 'a1' })], [{ id: 'u1', email: 'n@x.com', active: false }])
    expect((await sendFounderContactsDigests(db)).sent).toBe(0)
    expect(sendMail).not.toHaveBeenCalled()
    expect(stamped.flat()).toEqual(['a1'])
  })
})
