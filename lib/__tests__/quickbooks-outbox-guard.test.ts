/**
 * QuickBooks outbox: ONE helper family in lib/integrations.ts (`enqueueCustomerUpserted`, `enqueuePaymentRecorded`,
 * `enqueueRecordEvent`) and a closed list of callers. A new caller must be added here on purpose (docs/quickbooks-sync.md):
 *  - customer.upserted — contract signing only (`enrichCustomerFromContract`);
 *  - payment.recorded/refunded — `recordJobPayment` (job payments) and the customer-invoice payment/refund writers in lib/invoices.ts;
 *  - invoice.upserted/voided — job sale amount (`syncJobSaleAndCommissionBase`), invoice send/void (lib/invoices.ts), job cancel;
 *  - bill.recorded/voided — purchase-order bill record/void (lib/purchase-orders-db.ts).
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

  it('payments are queued only by the payment writers', () => {
    expect(callersOf('enqueuePaymentRecorded')).toEqual(['lib/invoices.ts', 'lib/job-payment-record.ts'])
    expect(callersOf('recordJobPayment').sort()).toEqual(expect.arrayContaining(['app/api/ops/jobs/[id]/payments/route.ts']))
  })

  it('invoice and bill events are queued only from their own writers', () => {
    expect(callersOf('enqueueRecordEvent')).toEqual([
      'app/api/ops/jobs/[id]/cancel/route.ts',
      'lib/invoices.ts',
      'lib/job-commission-base.ts',
      'lib/purchase-orders-db.ts',
    ])
  })

  it('the unused worker stubs stay gone and the helpers never throw into a money write', () => {
    const lib = read('lib/integrations.ts')
    expect(lib).not.toMatch(/getPendingOutboxEvents|markEventCompleted|markEventFailed/)
    const fn = lib.slice(lib.indexOf('export async function enqueueRecordEvent'))
    expect(fn).toMatch(/catch/)
  })

  it('the dead admin Integrations screen (it read a table that does not exist) stays deleted', () => {
    expect(fs.existsSync(path.join(ROOT, 'app/admin/integrations'))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'app/api/admin/integrations'))).toBe(false)
    for (const f of ALL) expect(`${f}: ${/\/admin\/integrations|from\('integrations'\)/.test(read(f))}`).toBe(`${f}: false`)
  })
})
