/**
 * Known Redundancy #11, Phase 3: mirror legacy job_product_orders onto job_cost_lines.
 *
 *   npx tsx --env-file=.env.local scripts/migrate-orders-to-cost-lines.ts            # DRY RUN, writes nothing
 *   npx tsx --env-file=.env.local scripts/migrate-orders-to-cost-lines.ts --apply    # after approval + migration applied
 *
 * Rules for each order:
 *   - already linked (a line has source_product_order_id = order)            -> skip
 *   - an existing active line has the same amount (±$1) and similar text     -> link that line (no insert)
 *   - otherwise                                                              -> insert a `material` line
 * Inserted lines are approved=true and deduct_from_commission_base=false, so they cannot block payroll
 * or change anyone's pay. created_at/updated_at are the ORDER's timestamps, capped at the job's current
 * eligibleAt, because derivePayrollEligibility uses the newest approved line's timestamp as "costs
 * ready": a later stamp would push an already-payable job into a later pay period. The dry run re-runs
 * derivePayrollEligibility before and after for every affected job and the apply refuses on any shift.
 * cost_type: labor orders -> labor, lender/lending fee -> misc, everything else -> material.
 * Returned orders mirror as negative amounts.
 * material lines never add to a job's cost while material_cost is set (lib/job-costs), so this does
 * not move any displayed number; the audit is re-run to prove it.
 */
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { derivePayrollEligibility } from '../lib/payroll-period-materialization'
import { summarizeJobCosts, netProductOrdersTotal } from '../lib/job-costs'

const APPLY = process.argv.includes('--apply')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('Use --env-file=.env.local')
const s = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const r2 = (v: number) => Math.round(v * 100) / 100
const words = (t: string) => (t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2)
const similar = (a: string, b: string) => {
  const A = new Set(words(a)); const B = words(b)
  return A.size > 0 && B.length > 0 && B.filter((w) => A.has(w)).length / Math.min(A.size, B.length) >= 0.5
}

async function all<T>(table: string, select: string): Promise<T[]> {
  const out: T[] = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await s.from(table).select(select).range(f, f + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data || []) as T[]))
    if (!data || data.length < 1000) break
  }
  return out
}

async function main() {
  const jobs = await all<any>('production_jobs', 'id, org_id, job_number, status, sale_date, sale_amount, commission_comp_base, commission_pre_tax_subtotal, dealer_fee_amount, salesperson_id, project_id, completed_at, allow_close_with_balance, material_cost, labor_cost')
  const orders = await all<any>('job_product_orders', 'id, org_id, job_id, description, supplier, amount, status, created_at')
  const lines = await all<any>('job_cost_lines', 'id, job_id, description, amount, cost_type, status, approved, deduct_from_commission_base, created_at, updated_at, deleted_at')
  const states = await all<any>('job_payroll_state', 'job_id, install_completed_at, fully_funded_at, costs_ready_at')
  const payments = await all<any>('job_payments', 'job_id, amount_cents, funding_status, paid_at, created_at')
  const snaps = new Set((await all<any>('payroll_job_snapshots', 'job_id')).map((r) => r.job_id))

  let linkedCol = true
  const probe = await s.from('job_cost_lines').select('source_product_order_id').limit(1)
  if (probe.error) linkedCol = false
  const linkMap = new Map<string, string>() // order id -> line id
  if (linkedCol) for (const l of await all<any>('job_cost_lines', 'id, source_product_order_id')) if (l.source_product_order_id) linkMap.set(l.source_product_order_id, l.id)
  if (APPLY && !linkedCol) throw new Error('--apply needs migration 202610090001 applied first')

  const jobById = new Map(jobs.map((j) => [j.id, j]))
  type Plan = { order: any; job: any; action: 'skip_linked' | 'link_existing' | 'insert'; lineId?: string; amount: number }
  const plans: Plan[] = []
  for (const o of orders) {
    const job = jobById.get(o.job_id)
    const amount = o.status === 'returned' ? -Math.abs(n(o.amount)) : n(o.amount)
    if (linkMap.has(o.id)) { plans.push({ order: o, job, action: 'skip_linked', amount }); continue }
    const dup = lines.find((l) => l.job_id === o.job_id && l.status === 'active' && !l.deleted_at &&
      Math.abs(n(l.amount) - Math.abs(amount)) <= 1 && similar(o.description, l.description))
    plans.push(dup ? { order: o, job, action: 'link_existing', lineId: dup.id, amount } : { order: o, job, action: 'insert', amount })
  }

  const costType = (o: any) => (/labor/i.test(o.description) && !/material/i.test(o.description) ? 'labor' : /lend|lender|dealer fee/i.test(o.description) ? 'misc' : 'material')
  const stampCache = new Map<string, string>()
  const stampFor = (job: any, o: any): string => {
    if (!stampCache.has(job.id)) {
      const own = lines.filter((l) => l.job_id === job.id && !l.deleted_at).map((l) => ({ ...l, amount: n(l.amount) }))
      const cap = derivePayrollEligibility({
        job, state: states.find((x) => x.job_id === job.id),
        payments: payments.filter((p) => p.job_id === job.id), costs: own,
      }).eligibleAt
      stampCache.set(job.id, cap ?? '')
    }
    const cap = stampCache.get(job.id)
    return cap && new Date(cap).getTime() < new Date(o.created_at).getTime() ? cap : o.created_at
  }
  // payroll-eligibility shift check for every job that would gain an inserted line
  const shifts: string[] = []
  const eligibility = (job: any, extra: any[]) => {
    const own = lines.filter((l) => l.job_id === job.id && !l.deleted_at).map((l) => ({ ...l, amount: n(l.amount) }))
    return derivePayrollEligibility({
      job, state: states.find((x) => x.job_id === job.id),
      payments: payments.filter((p) => p.job_id === job.id), costs: [...own, ...extra],
    })
  }
  for (const jobId of Array.from(new Set(plans.filter((p) => p.action === 'insert').map((p) => p.order.job_id)))) {
    const job = jobById.get(jobId)
    if (snaps.has(jobId)) continue // already snapshotted: eligibility no longer consulted
    const extra = plans.filter((p) => p.action === 'insert' && p.order.job_id === jobId)
      .map((p) => ({ job_id: jobId, amount: p.amount, approved: true, deduct_from_commission_base: false, created_at: stampFor(job, p.order), updated_at: stampFor(job, p.order) }))
    const before = eligibility(job, []), after = eligibility(job, extra)
    if (before.eligibleAt !== after.eligibleAt || before.reason !== after.reason)
      shifts.push(`${job.job_number}: eligibleAt ${before.eligibleAt ?? before.reason} -> ${after.eligibleAt ?? after.reason}`)
  }

  const counts = { skip_linked: 0, link_existing: 0, insert: 0 } as Record<string, number>
  for (const p of plans) counts[p.action]++
  const fmt = (p: Plan) => `${(p.job?.job_number ?? '?').padEnd(8)} ${p.action.padEnd(13)} ${p.action === 'insert' ? costType(p.order).padEnd(8) : ''} ${String(p.amount).padStart(10)}  ${p.order.status.padEnd(9)} "${p.order.description}"${p.order.supplier ? ` (${p.order.supplier})` : ''}${p.lineId ? ` -> existing line ${p.lineId.slice(0, 8)}` : ''}`
  const report = [
    `# Orders -> cost lines ${APPLY ? 'APPLY' : 'DRY RUN'} ${new Date().toISOString().slice(0, 10)}`,
    `Orders: ${orders.length} | insert ${counts.insert} | link existing ${counts.link_existing} | already linked ${counts.skip_linked}`,
    `Migration column present: ${linkedCol}`,
    `Payroll eligibility shifts caused by inserts (must be none): ${shifts.length ? '\n  ' + shifts.join('\n  ') : 'none'}`,
    '', ...plans.sort((a, b) => String(a.job?.job_number).localeCompare(String(b.job?.job_number))).map(fmt),
  ].join('\n')
  mkdirSync('tmp', { recursive: true })
  writeFileSync(`tmp/orders-to-cost-lines-${APPLY ? 'apply' : 'dryrun'}.txt`, report)
  console.log(report)
  if (!APPLY) return console.log('\nDRY RUN: nothing written.')
  if (shifts.length) throw new Error('Refusing to apply: payroll eligibility would shift (see above)')

  // per job: one batched insert (atomic), then link + log
  for (const jobId of Array.from(new Set(plans.filter((p) => p.action !== 'skip_linked').map((p) => p.order.job_id)))) {
    const mine = plans.filter((p) => p.order.job_id === jobId && p.action !== 'skip_linked')
    const toInsert = mine.filter((p) => p.action === 'insert')
    let inserted: any[] = []
    if (toInsert.length) {
      const { data, error } = await s.from('job_cost_lines').insert(toInsert.map((p) => ({
        org_id: p.order.org_id, job_id: jobId, description: p.order.description + (p.order.supplier ? ` (${p.order.supplier})` : ''),
        amount: p.amount, cost_type: costType(p.order), status: 'active', approved: true, deduct_from_commission_base: false,
        notes: `Mirrored from legacy Materials-tab order (${p.order.status}); original entry ${p.order.created_at.slice(0, 10)}.`, source_product_order_id: p.order.id,
        created_at: stampFor(jobById.get(jobId), p.order), updated_at: stampFor(jobById.get(jobId), p.order),
      }))).select('id, source_product_order_id')
      if (error) { console.error(`job ${jobById.get(jobId)?.job_number}: insert failed, skipped`, error.message); continue }
      inserted = data || []
    }
    for (const p of mine.filter((x) => x.action === 'link_existing')) {
      const { error } = await s.from('job_cost_lines').update({ source_product_order_id: p.order.id }).eq('id', p.lineId!).is('source_product_order_id', null)
      if (error) console.error('link failed', p.order.id, error.message)
    }
    const logRows = mine.map((p) => ({
      org_id: p.order.org_id, job_id: jobId, product_order_id: p.order.id, amount: p.amount,
      action: p.action === 'insert' ? 'inserted' : 'linked_existing',
      cost_line_id: p.action === 'insert' ? inserted.find((i) => i.source_product_order_id === p.order.id)?.id ?? null : p.lineId,
    }))
    const { error: logErr } = await s.from('job_cost_order_migration_log').upsert(logRows, { onConflict: 'product_order_id', ignoreDuplicates: true })
    if (logErr) console.error('log failed', logErr.message)
    console.log(`applied ${jobById.get(jobId)?.job_number}: ${toInsert.length} inserted, ${mine.length - toInsert.length} linked`)
  }
  // proof: shared calculator unchanged
  console.log('\nDone. Re-run scripts/audit-job-costs.ts and compare shared_total to the pre-run CSV.')
}
main().catch((e) => { console.error(e); process.exit(1) })
