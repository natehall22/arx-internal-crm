import { DEFAULT_WINDOW_DAYS, isSafeInternalLink, linesFor, parseAnnouncementInput, pickAnnouncement, roleGroupFor, type AnnouncementRow } from '@/lib/announcements'

const row = (over: Partial<AnnouncementRow> = {}): AnnouncementRow => ({
  id: 'a1', title: "What's new", link_url: '/whats-new', active: true,
  starts_at: '2026-10-22T12:00:00Z', ends_at: '2026-11-05T12:00:00Z',
  body: { owner: ['Owner line'], ops: ['Ops line 1', 'Ops line 2'], closer: ['Closer line'], setter: ['Setter line'] },
  ...over,
})
const day = (n: number) => new Date(Date.UTC(2026, 9, 22 + n, 13, 0, 0))

describe('roleGroupFor', () => {
  it.each([
    ['admin', 'owner'], ['owner', 'owner'], ['operations', 'ops'], ['sales_rep', 'closer'], ['closer', 'closer'],
    ['sales_manager', 'closer'], ['setter', 'setter'], ['canvasser', 'setter'], ['inside_sales', 'setter'],
  ])('%s → %s', (role, group) => expect(roleGroupFor(role)).toBe(group))
  it('unknown roles get no copy', () => {
    expect(roleGroupFor('custom')).toBeNull()
    expect(roleGroupFor(null)).toBeNull()
  })
})

describe('pickAnnouncement — shows from the start date for 14 days, then stops on its own', () => {
  it('is not shown before it starts', () => {
    expect(pickAnnouncement([row()], new Set(), 'admin', day(-1))).toBeNull()
  })
  it('is shown on day 0 and day 13', () => {
    expect(pickAnnouncement([row()], new Set(), 'admin', day(0))?.lines).toEqual(['Owner line'])
    expect(pickAnnouncement([row()], new Set(), 'admin', day(13))).not.toBeNull()
  })
  it('stops after day 14 with no one touching anything', () => {
    expect(pickAnnouncement([row()], new Set(), 'admin', day(14))).toBeNull()
    expect(pickAnnouncement([row()], new Set(), 'admin', day(30))).toBeNull()
  })
  it('the default window is 14 days', () => expect(DEFAULT_WINDOW_DAYS).toBe(14))
  it('each role gets its own copy', () => {
    expect(pickAnnouncement([row()], new Set(), 'operations', day(1))?.lines).toEqual(['Ops line 1', 'Ops line 2'])
    expect(pickAnnouncement([row()], new Set(), 'setter', day(1))?.lines).toEqual(['Setter line'])
  })
  it('a dismissed announcement stays gone', () => {
    expect(pickAnnouncement([row()], new Set(['a1']), 'admin', day(1))).toBeNull()
  })
  it('an inactive one never shows; a role with no copy sees nothing', () => {
    expect(pickAnnouncement([row({ active: false })], new Set(), 'admin', day(1))).toBeNull()
    expect(pickAnnouncement([row({ body: { owner: ['x'] } })], new Set(), 'setter', day(1))).toBeNull()
  })
  it('newest wins; an older one shows if the newest has no copy for this role', () => {
    const older = row({ id: 'old', starts_at: '2026-10-20T12:00:00Z', body: { setter: ['Old setter'] } })
    const newer = row({ id: 'new', body: { owner: ['New owner'] } })
    expect(pickAnnouncement([older, newer], new Set(), 'admin', day(1))?.announcement.id).toBe('new')
    expect(pickAnnouncement([older, newer], new Set(), 'setter', day(1))?.announcement.id).toBe('old')
  })
})

describe('linesFor caps copy at 3 short lines', () => {
  it('drops blanks and extras', () => {
    expect(linesFor({ owner: ['a', ' ', 'b', 'c', 'd'] }, 'owner')).toEqual(['a', 'b', 'c'])
  })
})

describe('parseAnnouncementInput', () => {
  const ok = { slug: 'whats-new-2026-10', title: "What's new", starts_at: '2026-10-22T12:00:00Z', ends_at: '2026-11-05T12:00:00Z', body: { owner: ['One', 'Two'] } }
  it('accepts a good one and defaults the link', () => {
    const r = parseAnnouncementInput(ok)
    expect(r.ok && r.value.link_url).toBe('/whats-new')
  })
  it.each([
    ['no copy', { ...ok, body: {} }],
    ['4 lines', { ...ok, body: { owner: ['1', '2', '3', '4'] } }],
    ['long line', { ...ok, body: { owner: ['x'.repeat(141)] } }],
    ['end before start', { ...ok, ends_at: '2026-10-01T00:00:00Z' }],
    ['external link', { ...ok, link_url: 'https://evil.example' }],
    ['protocol-relative link', { ...ok, link_url: '//evil.example' }],
    ['javascript link', { ...ok, link_url: 'javascript:alert(1)' }],
    ['bad slug', { ...ok, slug: 'Bad Slug!' }],
    ['no title', { ...ok, title: '  ' }],
  ])('rejects %s', (_l, body) => expect(parseAnnouncementInput(body as Record<string, unknown>).ok).toBe(false))
})

describe('isSafeInternalLink', () => {
  it('only in-app paths', () => {
    expect(isSafeInternalLink('/whats-new')).toBe(true)
    expect(isSafeInternalLink('/reports/explore?x=1')).toBe(true)
    expect(isSafeInternalLink('https://x.com')).toBe(false)
    expect(isSafeInternalLink('//x.com')).toBe(false)
    expect(isSafeInternalLink(null)).toBe(false)
  })
})
