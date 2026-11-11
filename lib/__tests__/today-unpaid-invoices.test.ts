/** @jest-environment node */
/**
 * Today card 'unpaid-invoices' (loadUnpaidInvoicesQueue): sent / partly paid service invoices (no job) that still owe
 * money, oldest due first; draft, void, paid, job invoices and other companies never show; paid-before-import counts;
 * money only when asked; the email version carries no customer name or amount in ref/note.
 */
jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'America/New_York' }))

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { loadUnpaidInvoicesQueue, unpaidInvoicesFailedQueue } from '@/lib/today'
import { buildTodayHtml } from '@/lib/morning-update-email'

const ORG = 'org-a'
const NOW = new Date('2026-11-11T15:00:00Z')
const inv = (id: string, o: Record<string, unknown>) => ({
  id,
  org_id: ORG,
  job_id: null,
  customer_id: 'c1',
  invoice_number: `INV-26-${id}`,
  status: 'sent',
  total_cents: 10000,
  due_at: '2026-11-01',
  issued_at: '2026-10-25',
  created_at: '2026-10-25T00:00:00Z',
  ...o,
})

function db() {
  return createFakeDb({
    customers: [
      { id: 'c1', org_id: ORG, name: 'Pat Lee', email: 'p@example.com' },
      { id: 'c2', org_id: ORG, name: 'Sam Roe', email: null },
      { id: 'cx', org_id: 'org-b', name: 'Other', email: null },
    ],
    job_invoices: [
      inv('0001', {}), // 10 days overdue, owes 100
      inv('0002', { customer_id: 'c2', due_at: '2026-11-20', total_cents: 25000 }), // due later
      inv('0003', { status: 'draft' }),
      inv('0004', { status: 'void' }),
      inv('0005', { status: 'paid' }),
      inv('0006', { status: 'partially_paid', due_at: '2026-10-20', total_cents: 20000 }), // paid 20000 -> settled
      inv('0007', { job_id: 'job-1' }), // a JOB invoice is the other card
      inv('0008', { org_id: 'org-b', customer_id: 'cx' }), // other company
      inv('0009', { customer_id: 'c2', due_at: null, total_cents: 5000, paid_outside_cents: 1000 }), // 40 owed, no due date
    ],
    invoice_payments: [{ id: 'a1', invoice_id: '0006', applied_cents: 20000 }, { id: 'a2', invoice_id: '0001', applied_cents: 2500 }],
  })
}

describe('loadUnpaidInvoicesQueue', () => {
  it('lists what is still owed, oldest due first, with amounts only when money is on', async () => {
    const q = await loadUnpaidInvoicesQueue(db().client as never, ORG, NOW, { money: true })
    expect(q.id).toBe('unpaid-invoices')
    expect(q.count).toBe(3)
    expect(q.items.map((i) => i.ref)).toEqual(['Invoice INV-26-0001', 'Invoice INV-26-0002', 'Invoice INV-26-0009'])
    expect(q.items[0].title).toBe('Pat Lee')
    expect(q.items[0].note).toBe('$75.00 owed · 10 days overdue')
    expect(q.items[1].note).toBe('$250.00 owed · due Nov 20')
    expect(q.items[2].note).toBe('$40.00 owed · no due date')
    expect(q.items[0].href).toBe('/invoices/0001/print')
  })

  it('no money → no amounts', async () => {
    const q = await loadUnpaidInvoicesQueue(db().client as never, ORG, NOW, { money: false })
    expect(q.items.map((i) => i.note)).toEqual(['10 days overdue', 'due Nov 20', 'no due date'])
    expect(JSON.stringify(q.items)).not.toMatch(/\$/)
  })

  it('the morning email shows invoice numbers and lateness, never a customer name or an amount', async () => {
    const q = await loadUnpaidInvoicesQueue(db().client as never, ORG, NOW, { money: false })
    const html = buildTodayHtml([q], 'https://crm.example.com')
    expect(html).toContain('Unpaid invoices (3)')
    expect(html).toContain('Invoice INV-26-0001')
    expect(html).not.toContain('Pat')
    expect(html).not.toContain('Sam')
    expect(html).not.toContain('$')
  })

  it('nothing owed → empty queue (the screen leaves it out)', async () => {
    const q = await loadUnpaidInvoicesQueue(createFakeDb({ customers: [], job_invoices: [], invoice_payments: [] }).client as never, ORG, NOW, { money: true })
    expect(q.count).toBe(0)
    expect(q.empty).toBe('No unpaid invoices.')
  })

  it('settled-but-still-sent invoices never push a real one out of the read (paged, filtered before any cap)', async () => {
    const settled = Array.from({ length: 620 }, (_, n) => inv(`s${String(n).padStart(4, '0')}`, { created_at: '2026-01-01T00:00:00Z', total_cents: 100, paid_outside_cents: 100 }))
    const d = createFakeDb({
      customers: [{ id: 'c1', org_id: ORG, name: 'Pat Lee', email: null }],
      job_invoices: [...settled, inv('zzzz', { created_at: '2026-11-01T00:00:00Z' })],
      invoice_payments: [],
    })
    const q = await loadUnpaidInvoicesQueue(d.client as never, ORG, NOW, { money: true })
    expect(q.count).toBe(1)
    expect(q.items[0].ref).toBe('Invoice INV-26-zzzz')
  })

  it('a failed read says so, with the same id', () => {
    const q = unpaidInvoicesFailedQueue()
    expect(q).toMatchObject({ id: 'unpaid-invoices', count: 0 })
    expect(q.empty).toContain('couldn’t load')
  })
})
