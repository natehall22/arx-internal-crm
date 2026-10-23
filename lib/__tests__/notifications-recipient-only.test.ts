/** @jest-environment node */
/**
 * Notifications are private to their recipient (Phase 0 security, 2026-10-21).
 *
 * 1. The migration makes SELECT/UPDATE recipient-only in RLS.
 * 2. Service-role callers bypass RLS, so EVERY app read/update of `notifications`
 *    must filter on `recipient_user_id` itself. This scans the source so a new
 *    reader without that filter fails CI.
 * 3. No browser ('use client') code reads notifications directly — the bell and
 *    the notifications page go through /api/notifications(/stream).
 */
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../..')
const MIGRATION = path.join(ROOT, 'supabase/migrations/202610210040_notifications_recipient_only.sql')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git', '__tests__', '.worktrees', '.claude'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const SOURCE_FILES = ['app', 'lib', 'components', 'hooks'].flatMap((d) =>
  fs.existsSync(path.join(ROOT, d)) ? walk(path.join(ROOT, d)) : []
)

/** Each `.from('notifications')` query chain (up to the next statement-ish boundary). */
function notificationChains(src: string): string[] {
  const chains: string[] = []
  const re = /\.from\(\s*['"]notifications['"]\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const rest = src.slice(m.index, m.index + 1200)
    const end = rest.search(/\n\s*\n|\n\s*(const|let|if|return|await|for|\}\s*\n)\b/)
    chains.push(end > 0 ? rest.slice(0, end) : rest)
  }
  return chains
}

describe('notifications RLS migration', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8')
  const body = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

  it('drops the org-wide read policy', () => {
    expect(body).toMatch(/DROP POLICY IF EXISTS "Users can read notifications" ON public\.notifications/)
  })

  it('SELECT and UPDATE are recipient-only, with WITH CHECK on UPDATE', () => {
    expect(body).toMatch(
      /CREATE POLICY notifications_recipient_select ON public\.notifications\s+FOR SELECT TO authenticated\s+USING \(recipient_user_id = \(SELECT auth\.uid\(\)\)\)/
    )
    expect(body).toMatch(
      /CREATE POLICY notifications_recipient_update ON public\.notifications\s+FOR UPDATE TO authenticated\s+USING \(recipient_user_id = \(SELECT auth\.uid\(\)\)\)\s+WITH CHECK \(recipient_user_id = \(SELECT auth\.uid\(\)\)\)/
    )
  })

  it('does not touch INSERT (routes create notifications for other people) or add DELETE', () => {
    expect(body).not.toMatch(/FOR INSERT/)
    expect(body).not.toMatch(/FOR DELETE/)
    expect(body).not.toMatch(/org_id = get_user_org_id/)
  })
})

describe('every app read/update of notifications filters by recipient', () => {
  const offenders: string[] = []
  let readers = 0
  for (const file of SOURCE_FILES) {
    const src = fs.readFileSync(file, 'utf8')
    for (const chain of notificationChains(src)) {
      if (/^\.from\(\s*['"]notifications['"]\s*\)\s*\.insert\(/.test(chain.replace(/\s+/g, ' ').replace(/^\s+/, ''))) continue
      if (!/\.(select|update|delete|upsert)\(/.test(chain)) continue
      // lib/threads/notify.ts scrubNotificationsForActivity: a system-side update of ONE activity's copies (no rows are returned).
      if (/notify\.ts$/.test(file) && /\.eq\(\s*['"]activity_id['"]/.test(chain) && !/\.select\(/.test(chain)) continue
      readers += 1
      if (!/recipient_user_id['"],/.test(chain)) offenders.push(`${path.relative(ROOT, file)}: ${chain.slice(0, 120)}`)
    }
  }

  it('scanner flags a reader without the filter and passes one with it', () => {
    const bad = notificationChains(`await supabase\n  .from('notifications')\n  .select('*')\n  .eq('org_id', orgId)\n`)
    const good = notificationChains(`await supabase\n  .from('notifications')\n  .select('*')\n  .eq('recipient_user_id', me)\n`)
    expect(bad.some((c) => /recipient_user_id['"],/.test(c))).toBe(false)
    expect(good.some((c) => /recipient_user_id['"],/.test(c))).toBe(true)
  })

  it('finds the known readers (scanner sanity check)', () => {
    // /api/notifications GET x2 + PATCH x2, stream x3, setter x2, lib/threads/waiting.ts x3
    expect(readers).toBe(12)
  })

  it('has no reader without a recipient_user_id filter', () => {
    expect(offenders).toEqual([])
  })
})

describe('no browser code reads notifications directly', () => {
  it("no 'use client' file selects from notifications", () => {
    const offenders = SOURCE_FILES.filter((file) => {
      const src = fs.readFileSync(file, 'utf8')
      if (!/^\s*['"]use client['"]/.test(src)) return false
      return notificationChains(src).some((c) => /\.(select|update|delete)\(/.test(c))
    }).map((f) => path.relative(ROOT, f))
    expect(offenders).toEqual([])
  })
})

describe('notification inserts only write columns that exist', () => {
  // Live columns (2026-10-21) + `data`, added by 202610210042_notifications_data_column.sql.
  const COLUMNS = new Set([
    'id', 'org_id', 'recipient_user_id', 'actor_user_id', 'type', 'title', 'body',
    'link_url', 'read_at', 'created_at', 'data',
  ])
  // Known leftovers, listed in notify-security.md (not part of this fix):
  //  - public-estimate-lead.ts: a fallback insert that only runs if the correct one fails.
  //  - NewWorkOrderClient.tsx: browser (anon) insert that RLS blocks anyway; needs an API route.
  const KNOWN_BROKEN = ['lib/public-estimate-lead.ts', 'app/work-orders/new/NewWorkOrderClient.tsx']

  /** Top-level keys of each `.from('notifications').insert({ ... })` object literal. */
  function insertKeys(src: string): string[][] {
    const out: string[][] = []
    const re = /from\(\s*['"]notifications['"]\s*\)\s*\.insert\(\s*\{/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      let depth = 1
      let i = m.index + m[0].length
      let buf = ''
      const keys: string[] = []
      for (; i < src.length && depth > 0; i++) {
        const c = src[i]
        if ('{[('.includes(c)) depth++
        else if ('}])'.includes(c)) depth--
        if (depth === 1) buf += c
        else if (depth === 2 && '{[('.includes(c)) buf += c
      }
      for (const part of buf.split(',')) {
        const k = part.match(/^\s*([a-z_]+)\s*(:|$)/)
        if (k) keys.push(k[1])
      }
      out.push(keys)
    }
    return out
  }

  it('the parser sees real keys', () => {
    expect(insertKeys(`x.from('notifications').insert({ org_id, user_id: u, data: { a: 1, b: 2 }, read: false })`)).toEqual([
      ['org_id', 'user_id', 'data', 'read'],
    ])
  })

  it('no unknown columns outside the listed leftovers', () => {
    const bad: string[] = []
    for (const file of SOURCE_FILES) {
      const rel = path.relative(ROOT, file)
      if (KNOWN_BROKEN.includes(rel)) continue
      const src = fs.readFileSync(file, 'utf8')
      for (const keys of insertKeys(src)) {
        const unknown = keys.filter((k) => !COLUMNS.has(k))
        if (unknown.length) bad.push(`${rel}: ${unknown.join(', ')}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('the data column migration exists and is additive', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/202610210042_notifications_data_column.sql'), 'utf8')
    expect(sql).toMatch(/ALTER TABLE public\.notifications ADD COLUMN IF NOT EXISTS data jsonb;/)
  })
})
