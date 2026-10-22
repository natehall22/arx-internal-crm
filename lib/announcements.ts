/**
 * "What's new" announcements: role groups, validation and "which one does this person see right now".
 * One module for the banner API, the /whats-new page, the owner editor and tests.
 */
export const ROLE_GROUPS = ['owner', 'ops', 'closer', 'setter'] as const
export type RoleGroup = (typeof ROLE_GROUPS)[number]

export const ROLE_GROUP_LABELS: Record<RoleGroup, string> = {
  owner: 'Owners / admin',
  ops: 'Ops',
  closer: 'Closers',
  setter: 'Setters',
}

export const MAX_LINES_PER_GROUP = 3
export const MAX_LINE_LENGTH = 140
/** Banners stop on their own this many days after they start (the default window). */
export const DEFAULT_WINDOW_DAYS = 14

/** Which copy a user gets. null = no copy for this role (no banner). */
export function roleGroupFor(role: string | null | undefined): RoleGroup | null {
  switch (String(role || '').toLowerCase().trim()) {
    case 'admin':
    case 'owner':
      return 'owner'
    case 'operations':
      return 'ops'
    case 'sales_rep':
    case 'rep':
    case 'closer':
    case 'sales_manager':
    case 'regional_manager':
      return 'closer'
    case 'setter':
    case 'canvasser':
    case 'inside_sales':
    case 'call_center':
    case 'setter_manager':
    case 'regional_setter_manager':
      return 'setter'
    default:
      return null
  }
}

export type AnnouncementBody = Partial<Record<RoleGroup, string[]>>

export type AnnouncementRow = {
  id: string
  title: string
  body: AnnouncementBody
  link_url: string
  starts_at: string
  ends_at: string
  active: boolean
}

export function linesFor(body: AnnouncementBody | null | undefined, group: RoleGroup | null): string[] {
  if (!group || !body) return []
  const lines = body[group]
  return Array.isArray(lines) ? lines.map((l) => String(l).trim()).filter(Boolean).slice(0, MAX_LINES_PER_GROUP) : []
}

/** Is this announcement showing right now (active and inside its window)? */
export function isShowing(a: Pick<AnnouncementRow, 'active' | 'starts_at' | 'ends_at'>, now: Date): boolean {
  return a.active && new Date(a.starts_at).getTime() <= now.getTime() && now.getTime() < new Date(a.ends_at).getTime()
}

/** The newest showing announcement this user hasn't dismissed and has copy for, or null. */
export function pickAnnouncement(
  rows: AnnouncementRow[],
  dismissedIds: ReadonlySet<string>,
  role: string | null | undefined,
  now: Date
): { announcement: AnnouncementRow; lines: string[] } | null {
  const group = roleGroupFor(role)
  const candidates = rows
    .filter((a) => isShowing(a, now) && !dismissedIds.has(a.id))
    .sort((x, y) => new Date(y.starts_at).getTime() - new Date(x.starts_at).getTime())
  for (const a of candidates) {
    const lines = linesFor(a.body, group)
    if (lines.length > 0) return { announcement: a, lines }
  }
  return null
}

/** Only in-app links: a relative path, never an external URL or javascript:. */
export function isSafeInternalLink(url: unknown): url is string {
  return typeof url === 'string' && /^\/[A-Za-z0-9/_\-?=&#.]*$/.test(url) && !url.startsWith('//')
}

export type AnnouncementInput = {
  slug: string
  title: string
  body: AnnouncementBody
  link_url: string
  starts_at: string
  ends_at: string
  active: boolean
}

export function parseAnnouncementInput(b: Record<string, unknown> | null): { ok: true; value: AnnouncementInput } | { ok: false; error: string } {
  if (!b) return { ok: false, error: 'Nothing to save' }
  const title = typeof b.title === 'string' ? b.title.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
  if (!title) return { ok: false, error: 'Give the announcement a title' }
  const slug = typeof b.slug === 'string' && /^[a-z0-9][a-z0-9-]{1,60}$/.test(b.slug) ? b.slug : null
  if (!slug) return { ok: false, error: 'Slug uses lowercase letters, numbers and dashes, like whats-new-2026-10' }
  const starts = new Date(String(b.starts_at))
  const ends = new Date(String(b.ends_at))
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return { ok: false, error: 'Start and end dates are required' }
  if (ends <= starts) return { ok: false, error: 'The end date must be after the start date' }
  const link = b.link_url === undefined || b.link_url === '' ? '/whats-new' : b.link_url
  if (!isSafeInternalLink(link)) return { ok: false, error: 'The link must be a page in this app, like /whats-new' }

  const body: AnnouncementBody = {}
  const rawBody = (b.body ?? {}) as Record<string, unknown>
  for (const g of ROLE_GROUPS) {
    const raw = Array.isArray(rawBody[g]) ? (rawBody[g] as unknown[]) : []
    const lines = raw.map((l) => String(l).replace(/\s+/g, ' ').trim()).filter(Boolean)
    if (lines.length > MAX_LINES_PER_GROUP) return { ok: false, error: `${ROLE_GROUP_LABELS[g]}: at most ${MAX_LINES_PER_GROUP} lines` }
    if (lines.some((l) => l.length > MAX_LINE_LENGTH)) return { ok: false, error: `${ROLE_GROUP_LABELS[g]}: keep each line under ${MAX_LINE_LENGTH} characters` }
    if (lines.length > 0) body[g] = lines
  }
  if (Object.keys(body).length === 0) return { ok: false, error: 'Write copy for at least one role' }
  return { ok: true, value: { slug, title, body, link_url: link, starts_at: starts.toISOString(), ends_at: ends.toISOString(), active: b.active !== false } }
}
