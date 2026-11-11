/** @jest-environment node */
/**
 * QuickBooks PR 1 ("deletes first"): until the sync worker exists (docs/quickbooks-sync.md), the outbox gets exactly two kinds
 * of rows, from exactly two places:
 *  - customer.upserted — contract signing only (`enrichCustomerFromContract`); booking, the repair-contract project tool,
 *    the customer backfill and customer linking all go through `upsertCustomer`, which never enqueues;
 *  - payment.recorded — recording a job payment (`recordJobPayment`, lib/job-payments.ts).
 * Invoices (job_invoices) are never queued: the design syncs one QuickBooks invoice per job = sale amount.
 */
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'test-helpers' || e.name === 'node_modules') continue
      sourceFiles(rel, out)
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel)
  }
  return out
}
const ALL = ['app', 'lib', 'components'].flatMap((d) => sourceFiles(d))
const callersOf = (name: string) => ALL.filter((f) => f !== 'lib/integrations.ts' && new RegExp(`(?<!function )\\b${name}\\(`).test(read(f))).sort()

describe('QuickBooks outbox: who can enqueue', () => {
  it('only contract signing queues a customer', () => {
    expect(callersOf('enqueueCustomerUpserted')).toEqual(['lib/customers.ts'])
    const src = read('lib/customers.ts')
    const upsert = src.slice(src.indexOf('export async function upsertCustomer'), src.indexOf('export async function enrichCustomerFromContract'))
    expect(upsert).not.toMatch(/enqueue/)
    expect(callersOf('enrichCustomerFromContract')).toEqual(['app/api/contracts/sign/route.ts'])
  })

  it.each([
    'lib/repair-order-form-project.ts',
    'app/api/admin/backfill-customers/route.ts',
    'app/api/customers/link/route.ts',
    'lib/customer-file/ensure-customer.ts',
  ])('%s creates customers without touching the outbox', (file) => {
    const src = read(file)
    expect(src).toMatch(/upsertCustomer\(/)
    expect(src).not.toMatch(/lib\/integrations|enqueue[A-Z]/)
  })

  it('only recording a job payment queues a payment (the one job payment writer)', () => {
    expect(callersOf('enqueuePaymentRecorded')).toEqual(['lib/job-payments.ts'])
    // Office "Add payment" and the online-payment webhook both go through recordJobPayment.
    expect(callersOf('recordJobPayment').sort()).toEqual(expect.arrayContaining(['app/api/ops/jobs/[id]/payments/route.ts']))
  })

  it('invoices are never queued, and the unused worker stubs are gone', () => {
    const lib = read('lib/integrations.ts')
    expect(lib).not.toMatch(/invoice\.(finalized|voided)|enqueueInvoice/)
    expect(lib).not.toMatch(/getPendingOutboxEvents|markEventCompleted|markEventFailed/)
    expect(read('lib/invoices.ts')).not.toMatch(/lib\/integrations|\.\/integrations'|enqueue/)
  })

  it('the dead admin Integrations screen (it read a table that does not exist) stays deleted', () => {
    expect(fs.existsSync(path.join(ROOT, 'app/admin/integrations'))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'app/api/admin/integrations'))).toBe(false)
    for (const f of ALL) expect(`${f}: ${/\/admin\/integrations|from\('integrations'\)/.test(read(f))}`).toBe(`${f}: false`)
  })
})
