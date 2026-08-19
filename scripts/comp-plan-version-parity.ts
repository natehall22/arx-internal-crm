/**
 * Phase 3 proof gate — run BEFORE applying the comp_plan_versions migration, and again
 * after, to prove the change pays every historical job exactly what it pays today.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/comp-plan-version-parity.ts          (pre-migration)
 *   npx tsx --env-file=.env.local scripts/comp-plan-version-parity.ts --live   (post-migration)
 *
 * Without --live the version rows are SIMULATED from the plan rows, exactly as the
 * migration's backfill would write them, so the gate can run before anything is applied.
 * With --live they are read from comp_plan_versions, which proves the migration actually
 * landed what the simulation promised.
 *
 * What it proves
 * --------------
 * The migration backfills one version per plan, dated far enough back to cover every
 * sale, copying the plan body verbatim. If that is right, then for every (user, sale
 * date) payroll resolves today, resolving through `comp_plan_versions` must produce
 * byte-identical terms and identical commission math.
 *
 * So the script walks every real (assignment, sale date) pair in the database, resolves
 * the plan body BOTH ways — live `comp_plans` row vs. the versioned resolver fed with
 * the exact rows the backfill would write — and compares:
 *
 *   1. every pay-affecting field, deep-equal
 *   2. `calculateCommissionFromPlanForSale` output on the job's real commissionable
 *      amount, across volume/sit/close-rate combinations that exercise tiers and
 *      volume bonuses, to the cent
 *
 * It reads only. Nothing is written, in either mode.
 */

import { createClient } from '@supabase/supabase-js'
import {
  COMP_PLAN_BODY_FIELDS,
  compPlanAsOf,
  type CompPlanVersionRow,
} from '../lib/comp-plan-version'
import {
  calculateCommissionFromPlanForSale,
  type CompPlanForCalc,
} from '../lib/calculate-commission-from-plan'

/**
 * The date the backfill stamps on every copied body. It must predate every sale in the
 * system; anything later leaves a window that resolves to null and pays nothing.
 */
const BACKFILL_EFFECTIVE_FROM = '2000-01-01'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, supabaseServiceKey)

type PlanRow = Record<string, unknown> & { id: string; org_id: string; name: string }

/** Settings that select different tiers / volume bonuses inside a plan body. */
const CALC_SHAPES = [
  { periodVolume: 0, periodSits: 0, periodClosingRatePct: null },
  { periodVolume: 50_000, periodSits: 5, periodClosingRatePct: 25 },
  { periodVolume: 250_000, periodSits: 20, periodClosingRatePct: 50 },
  { periodVolume: 1_000_000, periodSits: 60, periodClosingRatePct: 80 },
] as const

function bodyOf(plan: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const field of COMP_PLAN_BODY_FIELDS) body[field] = plan[field] ?? null
  return body
}

/** The rows the migration's backfill would insert, built from the live plan rows. */
function simulateBackfill(plans: PlanRow[]): CompPlanVersionRow[] {
  return plans.map((plan) => ({
    comp_plan_id: plan.id,
    effective_from: BACKFILL_EFFECTIVE_FROM,
    ...bodyOf(plan),
  }))
}

const LIVE = process.argv.includes('--live')

async function main() {
  const failures: string[] = []
  let comparisons = 0

  const { data: plans, error: plansError } = await supabase
    .from('comp_plans')
    .select('*')
  if (plansError) throw plansError
  const planRows = (plans || []) as PlanRow[]
  const plansById = new Map(planRows.map((plan) => [plan.id, plan]))

  let versions: CompPlanVersionRow[]
  if (LIVE) {
    const { data: versionRows, error: versionsError } = await supabase
      .from('comp_plan_versions')
      .select(
        'comp_plan_id, effective_from, plan_type, base_percentage, flat_amount, hourly_rate, unit_rate, unit_type, hybrid_components, tiers, volume_bonuses, team_overrides, is_manager_plan, personal_sales_enabled, team_override_enabled'
      )
    if (versionsError) throw versionsError
    versions = (versionRows || []) as unknown as CompPlanVersionRow[]
  } else {
    versions = simulateBackfill(planRows)
  }

  // Coverage: a plan with no version resolves to null and would silently fall back.
  for (const plan of planRows) {
    if (!versions.some((v) => v.comp_plan_id === plan.id)) {
      failures.push(`COVERAGE: plan ${plan.name} (${plan.id}) has no backfilled version`)
    }
  }

  const { data: assignments, error: assignmentsError } = await supabase
    .from('user_comp_plans')
    .select('user_id, org_id, comp_plan_id, effective_from, effective_to, override_percentage')
  if (assignmentsError) throw assignmentsError

  const { data: jobs, error: jobsError } = await supabase
    .from('production_jobs')
    .select('id, org_id, job_number, sale_date, commission_comp_base, sale_amount')
    .not('sale_date', 'is', null)
  if (jobsError) throw jobsError
  const jobRows = (jobs || []) as Array<{
    id: string
    org_id: string
    job_number: string | null
    sale_date: string
    commission_comp_base: number | null
    sale_amount: number | null
  }>

  // Every sale date that exists, plus today — payroll resolves on the sale date, and a
  // period materialized without one falls back to the period cutoff (a present date).
  const saleDates = Array.from(
    new Set([...jobRows.map((job) => job.sale_date.slice(0, 10)), new Date().toISOString().slice(0, 10)])
  ).sort()

  const commissionableAmounts = Array.from(
    new Set(
      jobRows
        .map((job) => Number(job.commission_comp_base) || Number(job.sale_amount) || 0)
        .filter((n) => n > 0)
    )
  )
  // A representative spread, plus a fixed value so a system with no jobs still exercises math.
  const amounts = commissionableAmounts.length > 0 ? commissionableAmounts : [16325]

  for (const assignment of (assignments || []) as Array<Record<string, string | number | null>>) {
    const plan = plansById.get(assignment.comp_plan_id as string)
    if (!plan) {
      failures.push(`DANGLING: assignment for user ${assignment.user_id} points at missing plan ${assignment.comp_plan_id}`)
      continue
    }

    for (const saleDate of saleDates) {
      const from = String(assignment.effective_from).slice(0, 10)
      const to = assignment.effective_to ? String(assignment.effective_to).slice(0, 10) : null
      // Only dates this assignment actually covers — payroll would not use it otherwise.
      if (saleDate < from) continue
      if (to && saleDate > to) continue

      const live = plan as unknown as CompPlanForCalc
      const versioned = compPlanAsOf(plan, versions, saleDate) as unknown as CompPlanForCalc

      const liveBody = JSON.stringify(bodyOf(plan))
      const versionedBody = JSON.stringify(bodyOf(versioned as unknown as Record<string, unknown>))
      if (liveBody !== versionedBody) {
        failures.push(
          `BODY MISMATCH: plan ${plan.name} on ${saleDate}\n  live:      ${liveBody}\n  versioned: ${versionedBody}`
        )
        continue
      }

      for (const amount of amounts) {
        // Volume, sits and closing rate all select tiers/bonuses inside the plan body,
        // so a body difference could hide at one setting and show at another.
        for (const shape of CALC_SHAPES) {
          const args = {
            commissionableAmount: amount,
            periodVolume: shape.periodVolume,
            periodSits: shape.periodSits,
            periodClosingRatePct: shape.periodClosingRatePct,
            overridePercentage: (assignment.override_percentage as number | null) ?? null,
          }
          const liveCalc = calculateCommissionFromPlanForSale({ plan: live, ...args })
          const versionedCalc = calculateCommissionFromPlanForSale({ plan: versioned, ...args })
          comparisons += 1
          if (JSON.stringify(liveCalc) !== JSON.stringify(versionedCalc)) {
            failures.push(
              `PAY MISMATCH: plan ${plan.name}, sale ${saleDate}, base $${amount}, ${JSON.stringify(shape)}\n` +
                `  live:      ${JSON.stringify(liveCalc)}\n  versioned: ${JSON.stringify(versionedCalc)}`
            )
          }
        }
      }
    }
  }

  console.log(`mode:         ${LIVE ? 'LIVE (comp_plan_versions)' : 'simulated backfill'}`)
  console.log(`versions:     ${versions.length}`)
  console.log(`plans:        ${planRows.length}`)
  console.log(`assignments:  ${(assignments || []).length}`)
  console.log(`jobs:         ${jobRows.length}`)
  console.log(`sale dates:   ${saleDates.length} (${saleDates[0]} → ${saleDates[saleDates.length - 1]})`)
  console.log(`comparisons:  ${comparisons}`)

  if (failures.length > 0) {
    console.error(`\n❌ ${failures.length} mismatch(es) — DO NOT APPLY THE MIGRATION\n`)
    for (const failure of failures.slice(0, 50)) console.error(failure)
    process.exit(1)
  }

  console.log('\n✅ parity: every assignment resolves identical terms and identical pay')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
