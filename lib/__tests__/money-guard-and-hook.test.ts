/** @jest-environment node */
import { execFileSync, spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync, chmodSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { lockMoneyPermissions } from '@/lib/money-permission-guard'

describe('only an owner changes money permissions', () => {
  const money = new Set(['m1', 'm2'])
  it('an owner list is used as sent', () => {
    expect(lockMoneyPermissions(['a', 'm1'], ['m2'], money, true)).toEqual(['a', 'm1'])
  })
  it('anyone else cannot add or remove them: requested money ids are dropped and existing ones kept', () => {
    expect(lockMoneyPermissions(['a', 'm1'], ['m2'], money, false).sort()).toEqual(['a', 'm2'])
    expect(lockMoneyPermissions([], ['m1', 'm2'], money, false).sort()).toEqual(['m1', 'm2'])
    expect(lockMoneyPermissions(['a'], [], money, false)).toEqual(['a'])
  })
})

describe('job billing check', () => {
  const fake = (rows: { denied?: string[]; names?: string[]; full?: boolean; label?: string }) =>
    ({
      from: (t: string) => {
        const api: any = { select: () => api, eq: () => api, in: () => api, maybeSingle: async () => ({ data: t === 'custom_roles' ? { name: rows.label ?? 'x', display_name: null } : null }), single: async () => ({ data: null }), then: undefined }
        if (t === 'permission_denials') return { select: () => ({ eq: async () => ({ data: (rows.denied ?? []).map((permission_name) => ({ permission_name })), error: null }) }) }
        if (t === 'user_permissions') return { select: () => ({ eq: async () => ({ data: (rows.names ?? []).map((name) => ({ permission: { name } })) }) }) }
        if (t === 'role_permissions') return { select: () => ({ eq: async () => ({ data: (rows.names ?? []).map((name) => ({ permission: { name } })) }) }) }
        return api
      },
    }) as never
  it('admin passes; an owner OFF switch beats full access AND the finance_admin label', async () => {
    expect(await callerCanAccessJobBilling(fake({}), { id: 'u', role: 'admin' })).toBe(true)
    expect(await callerCanAccessJobBilling(fake({ denied: ['money:record'] }), { id: 'u', role: 'admin' })).toBe(false)
    expect(await callerCanAccessJobBilling(fake({ denied: ['money:record'], label: 'finance_admin' }), { id: 'u', role: 'custom', custom_role_id: 'cr' })).toBe(false)
  })
  it('operations passes by default; a closer does not', async () => {
    expect(await callerCanAccessJobBilling(fake({}), { id: 'u', role: 'operations' })).toBe(true)
    expect(await callerCanAccessJobBilling(fake({}), { id: 'u', role: 'sales_rep' })).toBe(false)
    expect(await callerCanAccessJobBilling(fake({}), { id: 'u', role: 'regional_manager' })).toBe(false)
  })
})

describe('pre-push hook', () => {
  function repo() {
    const dir = mkdtempSync(join(tmpdir(), 'hook-'))
    const run = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim()
    run('init', '-q'); run('config', 'user.email', 't@t'); run('config', 'user.name', 't')
    writeFileSync(join(dir, 'f'), '1'); run('add', '.'); run('commit', '-qm', 'one')
    mkdirSync(join(dir, '.githooks')); copyFileSync(join(process.cwd(), '.githooks/pre-push'), join(dir, '.githooks/pre-push')); chmodSync(join(dir, '.githooks/pre-push'), 0o755)
    return { dir, sha: run('rev-parse', 'HEAD'), run }
  }
  const hook = (dir: string, sha: string) => spawnSync('bash', ['.githooks/pre-push'], { cwd: dir, input: `refs/heads/main ${sha} refs/heads/main ${'0'.repeat(40)}\n`, encoding: 'utf8' })
  it('refuses a commit with no stamp, accepts the stamped one, and a new commit needs its own stamp', () => {
    const { dir, sha, run } = repo()
    expect(hook(dir, sha).status).toBe(1)
    mkdirSync(join(dir, '.git/arx-gates-passed')); writeFileSync(join(dir, '.git/arx-gates-passed', sha), 'ok')
    expect(hook(dir, sha).status).toBe(0)
    writeFileSync(join(dir, 'f'), '2'); run('commit', '-qam', 'two')
    expect(hook(dir, run('rev-parse', 'HEAD')).status).toBe(1)
  })
  it('lets a branch deletion through', () => {
    const { dir } = repo()
    const r = spawnSync('bash', ['.githooks/pre-push'], { cwd: dir, input: `(delete) ${'0'.repeat(40)} refs/heads/x abc\n`, encoding: 'utf8' })
    expect(r.status).toBe(0)
  })
})
