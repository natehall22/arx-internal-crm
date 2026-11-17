/** @jest-environment node */
/** GET /api/invoices: money:record alone sees open balances only (no paid history, no paid-so-far); reports:financials sees all. */
let finance = false
jest.mock('@/lib/auth', () => ({ requireAuthApi: async () => ({ profile: { id: 'u1', org_id: 'org-a' } }) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
jest.mock('@/lib/finance-access', () => ({ callerCanAccessJobBilling: async () => true }))
jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'America/New_York' }))
jest.mock('@/lib/reporting/run', () => ({ buildReportContext: async () => ({ finance, canExport: true }) }))
jest.mock('@/lib/service-billing-db', () => ({
  loadAllInvoices: async () => ({
    capped: false,
    rows: [
      { id: 'a', status: 'sent', totalCents: 10000, paidCents: 2500, balanceCents: 7500 },
      { id: 'b', status: 'paid', totalCents: 10000, paidCents: 10000, balanceCents: 0 },
      { id: 'c', status: 'draft', totalCents: 5000, paidCents: 0, balanceCents: 0 },
    ],
  }),
}))

import { GET } from '@/app/api/invoices/route'

test('money:record only: open invoices, no paid amounts, no CSV', async () => {
  finance = false
  const j = await (await GET()).json()
  expect(j.rows.map((r: { id: string }) => r.id)).toEqual(['a'])
  expect(j.rows[0].paidCents).toBe(0)
  expect(j.fullHistory).toBe(false)
  expect(j.canExport).toBe(false)
})
test('reports:financials: everything, paid totals and CSV', async () => {
  finance = true
  const j = await (await GET()).json()
  expect(j.rows).toHaveLength(3)
  expect(j.rows[0].paidCents).toBe(2500)
  expect(j.fullHistory).toBe(true)
  expect(j.canExport).toBe(true)
})
