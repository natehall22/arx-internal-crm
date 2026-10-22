/** @jest-environment node */
/**
 * The database rule for reading job notes (public.can_view_job_board, migration
 * 202610210041) must give the same answer as the app's rule
 * (resolveEffectivePermissionNames -> canAccessJobBoardFromPermissionNames ->
 * canReadJobNotes) for every role. The legacy role matrix lives in TS, so the SQL
 * carries a literal list of legacy roles; this recomputes it from the real TS code
 * and fails if they drift.
 */
import fs from 'fs'
import path from 'path'

import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { canAccessJobBoardFromPermissionNames } from '@/lib/permissions'
import { canReadJobNotes } from '@/lib/ops-access'

const SQL = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/202610210041_production_job_notes_job_board_rls.sql'),
  'utf8'
)
const BODY = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

/** Every users.role enum value in prod (2026-10-21) plus every TS UserRole. */
const ALL_ROLES = [
  'admin', 'owner', 'regional_manager', 'regional_setter_manager', 'sales_manager',
  'setter_manager', 'sales_rep', 'closer', 'setter', 'rep', 'canvasser', 'inside_sales',
  'operations', 'call_center', 'custom', 'sub', 'manager',
]
const SQL_SUPERUSER_ROLES = ['admin', 'owner']
const SQL_PERMISSION_NAMES = ['admin:full', 'jobs:view', 'jobs:edit']

/** Stub service client: role_permissions / user_permissions return the given names. */
function stubAdmin(rolePerms: string[], userPerms: string[]) {
  const rows = (names: string[]) => ({ data: names.map((name) => ({ permission: { name } })), error: null })
  return {
    from: (table: string) => ({
      select: () => ({
        eq: async () => (table === 'role_permissions' ? rows(rolePerms) : rows(userPerms)),
      }),
    }),
  } as never
}

async function tsCanReadJobNotes(role: string, opts: { customRole?: string[]; userPerms?: string[] } = {}) {
  const perms = await resolveEffectivePermissionNames(
    stubAdmin(opts.customRole ?? [], opts.userPerms ?? []),
    'u1',
    { role, custom_role_id: opts.customRole ? 'cr1' : null }
  )
  return canReadJobNotes({ canJobBoard: canAccessJobBoardFromPermissionNames(perms) })
}

/** Same decision as the SQL function, written out from its literals. */
function sqlCanViewJobBoard(role: string, opts: { customRole?: string[]; userPerms?: string[] } = {}) {
  const legacy = (BODY.match(/ARRAY\[([^\]]*)\]::text\[\]/) || [])[1]
  const legacyRoles = (legacy || '').split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean)
  if (SQL_SUPERUSER_ROLES.includes(role)) return true
  if (!opts.customRole && legacyRoles.includes(role)) return true
  const names = [...(opts.customRole ?? []), ...(opts.userPerms ?? [])]
  return names.some((n) => SQL_PERMISSION_NAMES.includes(n))
}

describe('can_view_job_board (SQL) matches canReadJobNotes (TS) for every role', () => {
  it.each(ALL_ROLES)('legacy role %s', async (role) => {
    expect(sqlCanViewJobBoard(role)).toBe(await tsCanReadJobNotes(role))
  })

  it.each(ALL_ROLES)('role %s with a custom role granting jobs:view', async (role) => {
    const o = { customRole: ['jobs:view'] }
    expect(sqlCanViewJobBoard(role, o)).toBe(await tsCanReadJobNotes(role, o))
  })

  it.each(ALL_ROLES)('role %s with a custom role WITHOUT job permissions (matrix ignored)', async (role) => {
    const o = { customRole: ['leads:view'] }
    expect(sqlCanViewJobBoard(role, o)).toBe(await tsCanReadJobNotes(role, o))
  })

  it.each(ALL_ROLES)('role %s with a user grant of jobs:edit', async (role) => {
    const o = { userPerms: ['jobs:edit'] }
    expect(sqlCanViewJobBoard(role, o)).toBe(await tsCanReadJobNotes(role, o))
  })

  it.each(ALL_ROLES)('role %s with a user grant of admin:full', async (role) => {
    const o = { userPerms: ['admin:full'] }
    expect(sqlCanViewJobBoard(role, o)).toBe(await tsCanReadJobNotes(role, o))
  })

  it('setters, canvassers and sales reps cannot read job notes; admin and operations can', async () => {
    for (const r of ['setter', 'canvasser', 'sales_rep', 'setter_manager']) expect(await tsCanReadJobNotes(r)).toBe(false)
    for (const r of ['admin', 'owner', 'operations']) expect(await tsCanReadJobNotes(r)).toBe(true)
  })
})

describe('migration shape', () => {
  it('function is SECURITY DEFINER with a pinned search_path, executable only by authenticated/service_role', () => {
    expect(BODY).toMatch(/SECURITY DEFINER\s+SET search_path = public, pg_temp/)
    expect(BODY).toMatch(/REVOKE ALL ON FUNCTION public\.can_view_job_board\(uuid\) FROM PUBLIC;/)
    expect(BODY).toMatch(/REVOKE ALL ON FUNCTION public\.can_view_job_board\(uuid\) FROM anon;/)
    expect(BODY).toMatch(/GRANT EXECUTE ON FUNCTION public\.can_view_job_board\(uuid\) TO authenticated, service_role;/)
  })

  it('replaces the org-wide SELECT and the unchecked INSERT; leaves the subs policy alone', () => {
    expect(BODY).toMatch(/DROP POLICY IF EXISTS "Users can view job notes in their org"/)
    expect(BODY).toMatch(/DROP POLICY IF EXISTS "Users can add job notes"/)
    expect(BODY).not.toMatch(/Subs can view shared notes/)
    expect(BODY).toMatch(/FOR SELECT TO authenticated\s+USING \(\s+public\.can_view_job_board\(\(SELECT auth\.uid\(\)\)\)/)
    expect(BODY).toMatch(/FOR INSERT TO authenticated\s+WITH CHECK \(\s+user_id = \(SELECT auth\.uid\(\)\)\s+AND public\.can_view_job_board/)
  })

  it('every app writer of production_job_notes uses the service role (so the tighter INSERT breaks nothing)', () => {
    // Known writers: notes route, project review, job cancellation (called from contracts/sign with service client).
    const root = path.resolve(__dirname, '../..')
    for (const f of ['app/api/ops/jobs/[id]/notes/route.ts', 'app/api/projects/[id]/review/route.ts', 'app/api/contracts/sign/route.ts']) {
      expect(fs.readFileSync(path.join(root, f), 'utf8')).toMatch(/createServiceClient\(\)/)
    }
  })
})
