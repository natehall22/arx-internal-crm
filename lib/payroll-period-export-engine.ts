import type { SupabaseClient } from '@supabase/supabase-js'
import { buildCommissionPayrollSnapshot, isPoolCapExcludedPlanType } from '@/lib/commission-payroll'
import type { CompPlanForCalc } from '@/lib/calculate-commission-from-plan'
import {
  buildMonthlyTierMetricMaps,
  buildMonthlyVolumeMaps,
  collectParticipants,
  computeRawCommissionForParticipant,
  loadActiveCompPlanForUser,
  monthKeyFromSaleDate,
  periodSitsAndCloseRateForParticipant,
  scaleCommissionsToPool,
  type PayrollExportRow,
} from '@/lib/payroll-export'
import { payrollTierKey } from '@/lib/payroll-tier-key'

function padMonthRange(from: string, to: string): { volFrom: string; volTo: string } {
  const volFrom = from.length >= 7 ? `${from.slice(0, 7)}-01` : from
  const y = to.slice(0, 4)
  const m = parseInt(to.slice(5, 7), 10) || 12
  const last = new Date(parseInt(y, 10), m, 0).getDate()
  const volTo = to.length >= 7 ? `${to.slice(0, 7)}-${String(last).padStart(2, '0')}` : to
  return { volFrom, volTo }
}

/**
 * Same commission rows as GET /api/admin/payroll/export — single source for lock backfill and export.
 */
export async function computePayrollExportRowsForDateRange(
  supabase: SupabaseClient,
  orgId: string,
  from: string,
  to: string
): Promise<PayrollExportRow[]> {
  const { volFrom, volTo } = padMonthRange(from, to)

  const { data: volJobs, error: volErr } = await supabase
    .from('production_jobs')
    .select(
      'id, sale_date, salesperson_id, commission_comp_base, dealer_fee_amount, sale_amount, project_id'
    )
    .eq('org_id', orgId)
    .gte('sale_date', volFrom)
    .lte('sale_date', volTo)
    .not('sale_date', 'is', null)

  if (volErr) {
    throw new Error('Failed to load jobs for volume')
  }

  const projectIds = Array.from(
    new Set((volJobs || []).map((j) => j.project_id).filter(Boolean))
  ) as string[]

  const { data: projects } =
    projectIds.length > 0
      ? await supabase.from('projects').select('id, opportunity_id').in('id', projectIds)
      : { data: [] as { id: string; opportunity_id: string | null }[] }

  const projectOpp = new Map<string, string | null>()
  for (const p of projects || []) {
    projectOpp.set(p.id, p.opportunity_id ?? null)
  }

  const oppIds = Array.from(new Set(Array.from(projectOpp.values()).filter(Boolean))) as string[]

  const { data: opps } =
    oppIds.length > 0
      ? await supabase.from('opportunities').select('id, owner_user_id, setter_user_id').in('id', oppIds)
      : { data: [] as { id: string; owner_user_id: string | null; setter_user_id: string | null }[] }

  const opportunityById = new Map<string, { owner_user_id?: string | null; setter_user_id?: string | null }>()
  for (const o of opps || []) {
    opportunityById.set(o.id, { owner_user_id: o.owner_user_id, setter_user_id: o.setter_user_id })
  }

  const opportunityByProjectId = new Map<
    string,
    { owner_user_id?: string | null; setter_user_id?: string | null } | null
  >()
  for (const [pid, oid] of Array.from(projectOpp.entries())) {
    if (!oid) {
      opportunityByProjectId.set(pid, null)
      continue
    }
    opportunityByProjectId.set(pid, opportunityById.get(oid) ?? null)
  }

  const projectIdByJobId = new Map<string, string>()
  for (const j of volJobs || []) {
    if (j.project_id) projectIdByJobId.set(j.id, j.project_id)
  }

  const volumeMap = buildMonthlyVolumeMaps(volJobs || [], opportunityByProjectId, projectIdByJobId)

  const { sitsBySetterMonth, sitsByOwnerMonth, salesByOwnerMonth } = await buildMonthlyTierMetricMaps(
    supabase,
    orgId,
    volFrom,
    volTo
  )

  const { data: exportJobs, error: exErr } = await supabase
    .from('production_jobs')
    .select(
      'id, job_number, address_text, sale_date, sale_amount, commission_comp_base, commission_pre_tax_subtotal, dealer_fee_amount, salesperson_id, project_id, customer_id'
    )
    .eq('org_id', orgId)
    .gte('sale_date', from)
    .lte('sale_date', to)
    .not('sale_date', 'is', null)
    .order('sale_date', { ascending: true })

  if (exErr) {
    throw new Error('Failed to load jobs for export')
  }

  const exportProjectIds = Array.from(
    new Set(
      (exportJobs || [])
        .map((j) => j.project_id as string | null | undefined)
        .filter((id): id is string => typeof id === 'string')
    )
  )
  const customerIdByProjectId = new Map<string, string>()
  if (exportProjectIds.length > 0) {
    const { data: projRows } = await supabase
      .from('projects')
      .select('id, customer_id')
      .eq('org_id', orgId)
      .in('id', exportProjectIds)
    for (const p of projRows || []) {
      const cid = p.customer_id as string | null | undefined
      if (cid) customerIdByProjectId.set(p.id as string, cid)
    }
  }

  const customerIds = Array.from(
    new Set([
      ...(exportJobs || [])
        .map((j) => j.customer_id as string | null | undefined)
        .filter((id): id is string => typeof id === 'string'),
      ...Array.from(customerIdByProjectId.values()),
    ])
  )
  const customerNameById = new Map<string, string>()
  if (customerIds.length > 0) {
    const { data: custRows } = await supabase
      .from('customers')
      .select('id, name')
      .eq('org_id', orgId)
      .in('id', customerIds)
    for (const c of custRows || []) {
      customerNameById.set(c.id as string, (c.name as string) || '')
    }
  }

  const userIds = new Set<string>()
  for (const j of exportJobs || []) {
    const pid = j.project_id
    const opp = pid ? opportunityByProjectId.get(pid) ?? null : null
    for (const p of collectParticipants(j, opp)) {
      userIds.add(p.userId)
    }
  }

  const { data: users } =
    userIds.size > 0
      ? await supabase.from('users').select('id, full_name').eq('org_id', orgId).in('id', Array.from(userIds))
      : { data: [] as { id: string; full_name: string | null }[] }

  const userName = new Map<string, string>()
  for (const u of users || []) {
    userName.set(u.id, u.full_name || u.id)
  }

  const rows: PayrollExportRow[] = []

  for (const job of exportJobs || []) {
    const snap = buildCommissionPayrollSnapshot(job)
    const compBase = snap.compBase
    const poolCap = snap.poolCap
    const pid = job.project_id
    const opp = pid ? opportunityByProjectId.get(pid) ?? null : null
    const participants = collectParticipants(job, opp)
    if (!participants.length || compBase == null || compBase <= 0 || poolCap == null) {
      continue
    }

    const saleDate = job.sale_date || from
    const mk = monthKeyFromSaleDate(job.sale_date)

    const rawByUser = new Map<string, number>()
    const metaByUser = new Map<
      string,
      {
        plan: CompPlanForCalc | null
        calc: ReturnType<typeof computeRawCommissionForParticipant> | null
        periodVolume: number
        role: string
      }
    >()

    for (const part of participants) {
      const assignment = await loadActiveCompPlanForUser(supabase, part.userId, orgId, saleDate)
      const periodVolume = mk ? volumeMap.get(payrollTierKey(part.userId, mk)) || 0 : 0
      const { periodSits, periodClosingRatePct } = periodSitsAndCloseRateForParticipant({
        userId: part.userId,
        monthKey: mk,
        participantRole: part.role,
        sitsBySetterMonth,
        sitsByOwnerMonth,
        salesByOwnerMonth,
      })

      if (!assignment?.comp_plans) {
        metaByUser.set(part.userId, {
          plan: null,
          calc: null,
          periodVolume,
          role: part.role,
        })
        rawByUser.set(part.userId, 0)
        continue
      }

      const plan = assignment.comp_plans as unknown as CompPlanForCalc
      const calc = computeRawCommissionForParticipant({
        plan,
        commissionableAmount: compBase,
        periodVolume,
        periodSits,
        periodClosingRatePct,
        overridePercentage: assignment.override_percentage,
      })

      metaByUser.set(part.userId, { plan, calc, periodVolume, role: part.role })
      const excludeFromPool =
        calc.unsupported || isPoolCapExcludedPlanType(plan.plan_type)
      rawByUser.set(part.userId, excludeFromPool ? 0 : calc.totalAmount)
    }

    const { scaled, enforced } = scaleCommissionsToPool(rawByUser, poolCap)

    for (const part of participants) {
      const meta = metaByUser.get(part.userId)
      const calc = meta?.calc
      const plan = meta?.plan

      const noteParts = [calc?.note, snap.fallbackNote].filter(Boolean) as string[]
      if (!plan && !calc) {
        noteParts.push('No active comp plan assignment; default plan not found.')
      }

      const cid =
        (job.customer_id as string | null | undefined) ||
        (pid ? customerIdByProjectId.get(pid) : undefined) ||
        null
      const customerName = cid ? customerNameById.get(cid) ?? null : null

      rows.push({
        job_id: job.id,
        job_number: job.job_number,
        customer_name: customerName,
        sale_date: job.sale_date,
        address_text: job.address_text,
        sale_amount: job.sale_amount,
        commission_comp_base: compBase,
        pool_cap: poolCap,
        user_id: part.userId,
        user_name: userName.get(part.userId) || part.userId,
        participant_role: part.role,
        comp_plan_id: plan?.id ?? null,
        comp_plan_name: (plan?.name as string) || null,
        plan_type: plan?.plan_type ?? null,
        base_rate_pct: calc?.baseRate ?? null,
        period_volume: meta?.periodVolume ?? 0,
        volume_bonus_rate_pct: calc?.volumeBonusRate ?? 0,
        volume_bonus_flat: calc?.volumeBonusFlat ?? 0,
        effective_rate_pct: calc?.effectiveRate ?? 0,
        raw_commission: rawByUser.get(part.userId) || 0,
        scaled_commission: scaled.get(part.userId) || 0,
        pool_cap_enforced: enforced,
        unsupported_plan: calc?.unsupported ?? false,
        note: noteParts.length ? noteParts.join(' ') : null,
      })
    }
  }

  return rows
}
