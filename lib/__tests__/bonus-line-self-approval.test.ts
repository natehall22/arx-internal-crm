/** @jest-environment node */
/**
 * Security sweep 2026-11-13 #6: a regional bonus approver (regional_manager / regional_setter_manager) can approve bonuses
 * for people under them — never their own line. isUserInManagerHierarchy answers true for yourself, so the status route
 * refuses a non-payroll-admin acting on their own line before the hierarchy check.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

let actor = { id: 'mgr', org_id: 'org-a', role: 'regional_manager' }
jest.mock('@/lib/auth', () => ({
  requireAuthApi: jest.fn(async () => ({ authUser: { id: actor.id, email: null }, profile: actor })),
}))
let db: ReturnType<typeof createFakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { PATCH } from '@/app/api/admin/payroll/bonus-lines/[bonusLineId]/status/route'

const patch = (id: string, action = 'approve') =>
  PATCH(
    new Request(`https://crm.example/api/admin/payroll/bonus-lines/${id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    }) as never,
    { params: { bonusLineId: id } },
  )

beforeEach(() => {
  actor = { id: 'mgr', org_id: 'org-a', role: 'regional_manager' }
  db = createFakeDb({
    users: [
      { id: 'mgr', org_id: 'org-a', manager_user_id: null },
      { id: 'rep', org_id: 'org-a', manager_user_id: 'mgr' },
      { id: 'admin1', org_id: 'org-a', manager_user_id: null },
    ],
    payroll_periods: [{ id: 'w1', org_id: 'org-a', status: 'open', locked_at: null, paid_at: null }],
    payroll_bonus_lines: [
      { id: 'own', org_id: 'org-a', payroll_period_id: 'w1', user_id: 'mgr', status: 'pending_approval' },
      { id: 'team', org_id: 'org-a', payroll_period_id: 'w1', user_id: 'rep', status: 'pending_approval' },
    ],
  })
})

const statusOf = (id: string) => db.tables.payroll_bonus_lines.find((r) => r.id === id)?.status

test.each(['regional_manager', 'regional_setter_manager'])('a %s cannot approve their own bonus (403, unchanged)', async (role) => {
  actor = { ...actor, role }
  const res = await patch('own')
  expect(res.status).toBe(403)
  expect(statusOf('own')).toBe('pending_approval')
  expect(db.writes).toEqual([])
})

test('a regional approver cannot reject or reopen their own line either', async () => {
  expect((await patch('own', 'reject')).status).toBe(403)
  expect(db.writes).toEqual([])
})

test('a regional approver still approves a bonus for someone under them', async () => {
  const res = await patch('team')
  expect(res.status).toBe(200)
  expect(statusOf('team')).toBe('approved')
})

test('a payroll admin may still approve any line, their own included', async () => {
  actor = { id: 'mgr', org_id: 'org-a', role: 'admin' }
  expect((await patch('own')).status).toBe(200)
  expect(statusOf('own')).toBe('approved')
})
