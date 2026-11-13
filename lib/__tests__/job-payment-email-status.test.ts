/** @jest-environment node */
/**
 * Codex audit 2026-11-13 #9: the payment email's Status row is THE paid-in-full answer passed in by recordJobPayment
 * (getJobPaymentSummary → lib/job-collection.ts), never re-derived from the sale amount — so a taxed or time & materials job
 * can't read "Paid in full" beside a non-zero Remaining.
 */
const sent: Array<{ html: string }> = []
jest.mock('@/lib/admin-email-blasts', () => ({
  getOrgEmailBlastSettings: () => ({}),
  resolveEmailBlastRecipients: async () => ({ emails: ['ops@example.com'], users: [] }),
}))
jest.mock('@/lib/setter-email', () => ({
  getCrmEmailFrom: () => 'crm@example.com',
  getMailTransport: () => ({ sendMail: async (m: { html: string }) => { sent.push(m) } }),
}))
jest.mock('@/lib/company-links', () => ({ orgAppUrl: async () => 'https://crm.example' }))

import { notifyAdminOpsOfJobPayment } from '@/lib/job-payment-email'

const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { settings: {} }, error: null }) }) }) }) } as never
const base = { orgId: 'o', jobId: 'j', jobNumber: '26-0001', addressText: '1 Main', amountCents: 100000, payer: 'Pat', method: 'check', paidAt: '2026-11-13' }

beforeEach(() => {
  sent.length = 0
  process.env.SMTP_HOST = 'smtp.example'
})
afterAll(() => {
  delete process.env.SMTP_HOST
})

it('payments cover the contract but invoice tax is still owed: Balance remaining, not Paid in full', async () => {
  await notifyAdminOpsOfJobPayment(client, { ...base, collectedCents: 1_000_000, remainingCents: 50_000, saleAmountCents: 1_050_000, paidInFull: false })
  expect(sent[0].html).toContain('Balance remaining')
  expect(sent[0].html).not.toContain('Paid in full')
  expect(sent[0].html).toContain('$500.00')
})

it('a super-admin force (or payments in full) reads Paid in full', async () => {
  await notifyAdminOpsOfJobPayment(client, { ...base, collectedCents: 900_000, remainingCents: 100_000, saleAmountCents: 1_000_000, paidInFull: true })
  expect(sent[0].html).toContain('Paid in full')
})
