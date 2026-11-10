/** @jest-environment node */
/** "Which person in this company gets this" — never another company's user, never a built-in inbox. */
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { resolveCompanyInboxEmail, resolveCompanyRecipient } from '@/lib/company-recipient'

const A = 'dddddddd-0000-4000-8000-000000000001'
const B = 'dddddddd-0000-4000-8000-000000000002'
const C = 'dddddddd-0000-4000-8000-000000000003'

const seed = () =>
  createFakeDb({
    orgs: [{ id: A, email: 'office@a.test' }, { id: B, email: null }, { id: C, email: '  ' }],
    users: [
      { id: 'a-old', org_id: A, role: 'admin', active: true, email: 'first@a.test', created_at: '2026-01-01T00:00:00Z' },
      { id: 'a-rep', org_id: A, role: 'sales_rep', active: true, email: 'rep@a.test', created_at: '2025-01-01T00:00:00Z' },
      { id: 'b-gone', org_id: B, role: 'admin', active: false, email: 'gone@b.test', created_at: '2025-01-01T00:00:00Z' },
      { id: 'b-new', org_id: B, role: 'admin', active: true, email: 'new@b.test', created_at: '2026-06-01T00:00:00Z' },
      { id: 'b-old', org_id: B, role: 'admin', active: true, email: 'old@b.test', created_at: '2026-02-01T00:00:00Z' },
    ],
  }).client as never

test('fallback = longest-standing ACTIVE admin of that company (a rep or inactive admin never)', async () => {
  expect(await resolveCompanyRecipient(seed(), B, [])).toEqual({ id: 'b-old', email: 'old@b.test' })
  expect(await resolveCompanyRecipient(seed(), A, [])).toEqual({ id: 'a-old', email: 'first@a.test' })
})

test('a configured user wins only when an active user of the SAME company', async () => {
  expect(await resolveCompanyRecipient(seed(), A, ['a-rep'])).toEqual({ id: 'a-rep', email: 'rep@a.test' })
  expect(await resolveCompanyRecipient(seed(), B, ['a-rep', null, ''])).toEqual({ id: 'b-old', email: 'old@b.test' })
  expect(await resolveCompanyRecipient(seed(), B, ['b-gone'])).toEqual({ id: 'b-old', email: 'old@b.test' })
})

test('no active admin → null (callers send nothing)', async () => {
  expect(await resolveCompanyRecipient(seed(), C, [])).toBeNull()
})

test('company inbox = orgs.email column, else longest-standing active admin, else null', async () => {
  expect(await resolveCompanyInboxEmail(seed(), A)).toBe('office@a.test')
  expect(await resolveCompanyInboxEmail(seed(), B)).toBe('old@b.test')
  expect(await resolveCompanyInboxEmail(seed(), C)).toBeNull()
})
