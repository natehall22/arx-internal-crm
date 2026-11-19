/**
 * Only an approved purchase-order bill can reach QuickBooks as a bill. A typed job cost (a cost line entered by hand on the
 * job, the Materials "+ Job Cost" button) is a number in the job's profit ledger, never a QuickBooks expense — otherwise a
 * company whose accountant enters supplier bills in QuickBooks would count every expense twice.
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

describe('QuickBooks: only approved PO bills enqueue bill.recorded', () => {
  it("the 'bill.recorded' event is written from exactly one place that records a bill, plus the sweep's catch-up of the same table", () => {
    const writers = ALL.filter((f) => /eventType:\s*'bill\.recorded'/.test(read(f))).sort()
    expect(writers).toEqual(['lib/purchase-orders-db.ts', 'lib/quickbooks/sweep.ts'])
  })

  it('the sweep only catches up ACTIVE purchase_order_bills, never job cost lines', () => {
    const sweep = read('lib/quickbooks/sweep.ts')
    const block = sweep.slice(sweep.indexOf('// Approved vendor bills'))
    expect(block).toMatch(/from\('purchase_order_bills'\)/)
    expect(block).toMatch(/eq\('status', 'active'\)/)
    expect(block).not.toMatch(/job_cost_lines/)
  })

  it('in purchase-orders-db the event comes from recordPoBill, after the bill row exists', () => {
    const src = read('lib/purchase-orders-db.ts')
    const at = src.indexOf("eventType: 'bill.recorded'")
    const fn = src.indexOf('export async function recordPoBill')
    const next = src.indexOf('export async function voidPoBill')
    expect(at).toBeGreaterThan(fn)
    expect(at).toBeLessThan(next)
    expect(src.indexOf(".from('purchase_order_bills')\n    .insert", fn)).toBeLessThan(at)
  })

  it('typed job costs never touch the outbox: the cost ledger writer and the cost-lines route do not import it', () => {
    for (const f of ['lib/job-cost-ledger.ts', 'app/api/ops/jobs/[id]/cost-lines/route.ts']) {
      expect(`${f}: ${/lib\/integrations|enqueue[A-Z]/.test(read(f))}`).toBe(`${f}: false`)
    }
  })

  it('the bill handler reads purchase_order_bills only', () => {
    const h = read('lib/quickbooks/handlers.ts')
    const start = h.indexOf('billRecorded')
    expect(h.slice(start, start + 2500)).not.toMatch(/job_cost_lines/)
  })
})
