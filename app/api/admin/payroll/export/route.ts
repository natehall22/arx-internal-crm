import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuthApi } from '@/lib/auth'
import { buildCommissionPayrollSnapshot, isPoolCapExcludedPlanType } from '@/lib/commission-payroll'
import {
  ADDITIVE_DEAL_COMMISSION_ROLES,
  buildMonthlyTierMetricMaps,
  buildMonthlyVolumeMaps,
  collectParticipants,
  computeRawCommissionForParticipant,
  loadActiveCompPlanForUser,
  monthKeyFromSaleDate,
  periodSitsAndCloseRateForParticipant,
  poolKey,
  resolveAdditiveParticipantAmount,
  scaleCommissionsToPool,
  type DealCommissionRoleParticipant,
  type PayrollExportRow,
} from '@/lib/payroll-export'
import type { CompPlanForCalc } from '@/lib/calculate-commission-from-plan'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import {
  loadInspectorByOpportunity,
  normalizeInspectionRate,
  withDerivedInspector,
} from '@/lib/job-inspector-attribution'

export const dynamic = 'force-dynamic'

function padMonthRange(from: string, to: string): { volFrom: string; volTo: string } {
  const volFrom = from.length >= 7 ? `${from.slice(0, 7)}-01` : from
  const y = to.slice(0, 4)
  const m = parseInt(to.slice(5, 7), 10) || 12
  const last = new Date(parseInt(y, 10), m, 0).getDate()
  const volTo = to.length >= 7 ? `${to.slice(0, 7)}-${String(last).padStart(2, '0')}` : to
  return { volFrom, volTo }
}

export async function GET(request: NextRequest) {
  try {
    let profile
    try {
      const ctx = await requireAuthApi()
      profile = ctx.profile
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!isPayrollAdminRole(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (!from || !to || from.length < 8 || to.length < 8) {
      return NextResponse.json(
        { error: 'Query params "from" and "to" are required (YYYY-MM-DD).' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()
    const orgId = profile.org_id

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
      console.error('payroll export volume jobs', volErr)
      return NextResponse.json({ error: 'Failed to load jobs for volume' }, { status: 500 })
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

    const opportunityByProjectId = new Map<string, { owner_user_id?: string | null; setter_user_id?: string | null } | null>()
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

    const { sitsBySetterMonth, sitsByOwnerMonth, salesByOwnerMonth, skippedOpportunityIds } =
      await buildMonthlyTierMetricMaps(supabase, orgId, volFrom, volTo)

    if (skippedOpportunityIds.length > 0) {
      console.warn(
        'payroll export: opportunities skipped for missing inspection timestamp',
        { orgId, volFrom, volTo, skippedOpportunityIds }
      )
    }

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
      console.error('payroll export jobs', exErr)
      return NextResponse.json({ error: 'Failed to load jobs' }, { status: 500 })
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

    // Additive per-job participants (inspector, manager overrides). Batch-loaded for
    // every exported job so the preview an admin reviews matches what the period lock
    // will actually pay — materializePayrollPeriod() writes these same rows.
    const exportJobIds = (exportJobs || []).map((j) => j.id as string)
    const additiveByJobId = new Map<string, DealCommissionRoleParticipant[]>()
    if (exportJobIds.length > 0) {
      const { data: additiveRoleRows, error: additiveRoleError } = await supabase
        .from('deal_commission_roles')
        .select('job_id, user_id, role, override_amount, override_percent, premier_pricing_amount')
        .eq('org_id', orgId)
        .in('job_id', exportJobIds)
        .in('role', ADDITIVE_DEAL_COMMISSION_ROLES as readonly string[])
      // Fail closed: an empty result from an error would silently omit real pay.
      if (additiveRoleError) throw additiveRoleError
      for (const row of additiveRoleRows || []) {
        const jobId = row.job_id as string
        const participant: DealCommissionRoleParticipant = {
          userId: row.user_id as string,
          role: row.role as DealCommissionRoleParticipant['role'],
          overrideAmount: row.override_amount != null ? Number(row.override_amount) : null,
          overridePercent: row.override_percent != null ? Number(row.override_percent) : null,
          premierPricingAmount:
            row.premier_pricing_amount != null ? Number(row.premier_pricing_amount) : null,
        }
        const list = additiveByJobId.get(jobId) || []
        list.push(participant)
        additiveByJobId.set(jobId, list)
        userIds.add(participant.userId)
      }
    }

    // Derived inspection line: same rules the period lock uses, so the preview and
    // the locked payroll agree on who gets paid for inspecting.
    const { data: orgRateRow, error: orgRateError } = await supabase
      .from('orgs')
      .select('inspection_commission_rate')
      .eq('id', orgId)
      .maybeSingle()
    if (orgRateError) throw orgRateError
    const inspectionRatePercent = normalizeInspectionRate(orgRateRow?.inspection_commission_rate)
    const exportOpportunityIds = Array.from(
      new Set(
        (exportJobs || [])
          .map((j) => (j.project_id ? projectOpp.get(j.project_id) : null))
          .filter((v): v is string => Boolean(v))
      )
    )
    const inspectorByOpportunity =
      inspectionRatePercent > 0
        ? await loadInspectorByOpportunity(supabase, orgId, exportOpportunityIds)
        : new Map<string, string>()
    for (const inspectorUserId of Array.from(inspectorByOpportunity.values())) {
      userIds.add(inspectorUserId)
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
    // Track which user+month combos have already received their flat period bonus
    // so it's applied exactly once regardless of how many sales fall in that month.
    const flatBonusApplied = new Map<string, boolean>()

    for (const job of exportJobs || []) {
      const snap = buildCommissionPayrollSnapshot(job)
      const compBase = snap.compBase
      const poolCap = snap.poolCap
      const pid = job.project_id
      const opp = pid ? opportunityByProjectId.get(pid) ?? null : null
      const participants = collectParticipants(job, opp)
      const jobOpportunityId = pid ? projectOpp.get(pid) ?? null : null
      const additiveParticipants = withDerivedInspector(
        additiveByJobId.get(job.id as string) || [],
        jobOpportunityId ? inspectorByOpportunity.get(jobOpportunityId) ?? null : null,
        inspectionRatePercent
      )
      // A job with only additive participants (e.g. an inspector on a job whose
      // closer has no resolvable plan) still owes money — don't drop it.
      if (
        (!participants.length && !additiveParticipants.length) ||
        compBase == null ||
        compBase <= 0 ||
        poolCap == null
      ) {
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
          effectiveFlatBonus: number
        }
      >()

      for (const part of participants) {
        const assignment = await loadActiveCompPlanForUser(supabase, part.userId, orgId, saleDate)
        const periodVolume = mk ? volumeMap.get(`${part.userId}|${mk}`) || 0 : 0
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
            effectiveFlatBonus: 0,
          })
          rawByUser.set(poolKey(part.userId, part.role), 0)
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

        // Apply the period flat bonus (e.g. "$500 when sits ≥ 20") once per
        // user per month. The bonus is excluded from pool-cap scaling.
        const bonusKey = `${part.userId}|${mk ?? ''}`
        const rawFlatBonus = calc.volumeBonusFlat ?? 0
        const effectiveFlatBonus =
          rawFlatBonus > 0 && !flatBonusApplied.has(bonusKey) ? rawFlatBonus : 0
        if (rawFlatBonus > 0) flatBonusApplied.set(bonusKey, true)

        metaByUser.set(part.userId, { plan, calc, periodVolume, role: part.role, effectiveFlatBonus })
        const excludeFromPool =
          calc.unsupported || isPoolCapExcludedPlanType(plan.plan_type)
        rawByUser.set(poolKey(part.userId, part.role), excludeFromPool ? 0 : calc.totalAmount)
      }

      // Additive lines count inside the pool cap, so they must be in rawByUser
      // before scaling — same rule the period lock applies.
      const additivePayable = additiveParticipants.flatMap((participant) => {
        const resolved = resolveAdditiveParticipantAmount(participant, compBase)
        if (resolved.basis === 'none' || resolved.amount === 0) return []
        return [{ participant, resolved }]
      })
      for (const { participant, resolved } of additivePayable) {
        rawByUser.set(poolKey(participant.userId, participant.role), resolved.amount)
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
          volume_bonus_flat: meta?.effectiveFlatBonus ?? 0,
          effective_rate_pct: calc?.effectiveRate ?? 0,
          raw_commission:
            (rawByUser.get(poolKey(part.userId, part.role)) || 0) + (meta?.effectiveFlatBonus ?? 0),
          scaled_commission:
            (scaled.get(poolKey(part.userId, part.role)) || 0) + (meta?.effectiveFlatBonus ?? 0),
          pool_cap_enforced: enforced,
          unsupported_plan: calc?.unsupported ?? false,
          note: noteParts.length ? noteParts.join(' ') : null,
        })
      }

      // Additive rows are paid outside the commission pool: raw === scaled, and no
      // comp plan is involved (the rate lives on the deal_commission_roles row).
      for (const { participant, resolved } of additivePayable) {
        const cid =
          (job.customer_id as string | null | undefined) ||
          (pid ? customerIdByProjectId.get(pid) : undefined) ||
          null

        rows.push({
          job_id: job.id,
          job_number: job.job_number,
          customer_name: cid ? customerNameById.get(cid) ?? null : null,
          sale_date: job.sale_date,
          address_text: job.address_text,
          sale_amount: job.sale_amount,
          commission_comp_base: compBase,
          pool_cap: poolCap,
          user_id: participant.userId,
          user_name: userName.get(participant.userId) || participant.userId,
          participant_role: participant.role,
          comp_plan_id: null,
          comp_plan_name: null,
          plan_type: null,
          base_rate_pct: resolved.basis === 'percent' ? participant.overridePercent : null,
          period_volume: 0,
          volume_bonus_rate_pct: 0,
          volume_bonus_flat: 0,
          effective_rate_pct: resolved.basis === 'percent' ? participant.overridePercent ?? 0 : 0,
          raw_commission: resolved.amount,
          scaled_commission:
            scaled.get(poolKey(participant.userId, participant.role)) ?? resolved.amount,
          pool_cap_enforced: enforced,
          unsupported_plan: false,
          note:
            resolved.basis === 'percent'
              ? `Additive ${participant.role} line: ${participant.overridePercent}% of commission base, counted inside the pool cap.`
              : `Additive ${participant.role} line: flat override, counted inside the pool cap.`,
        })
      }
    }

    const format = searchParams.get('format')
    if (format === 'csv') {
      const header = [
        'job_number',
        'customer_name',
        'sale_date',
        'address',
        'sale_amount',
        'commission_comp_base',
        'pool_cap',
        'user_id',
        'user_name',
        'participant_role',
        'comp_plan_name',
        'plan_type',
        'base_rate_pct',
        'period_volume',
        'volume_bonus_rate_pct',
        'volume_bonus_flat',
        'effective_rate_pct',
        'raw_commission',
        'scaled_commission',
        'pool_cap_enforced',
        'unsupported_plan',
        'note',
      ]
      const lines = [
        header.join(','),
        ...rows.map((r) =>
          [
            r.job_number,
            `"${(r.customer_name || '').replace(/"/g, '""')}"`,
            r.sale_date ?? '',
            `"${(r.address_text || '').replace(/"/g, '""')}"`,
            r.sale_amount ?? '',
            r.commission_comp_base ?? '',
            r.pool_cap ?? '',
            r.user_id,
            `"${(r.user_name || '').replace(/"/g, '""')}"`,
            r.participant_role,
            `"${(r.comp_plan_name || '').replace(/"/g, '""')}"`,
            r.plan_type ?? '',
            r.base_rate_pct ?? '',
            r.period_volume,
            r.volume_bonus_rate_pct,
            r.volume_bonus_flat,
            r.effective_rate_pct ?? '',
            r.raw_commission,
            r.scaled_commission,
            r.pool_cap_enforced,
            r.unsupported_plan,
            `"${(r.note || '').replace(/"/g, '""')}"`,
          ].join(',')
        ),
      ]
      return new NextResponse(lines.join('\n'), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="payroll-export-${from}-to-${to}.csv"`,
        },
      })
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      orgId,
      from,
      to,
      rowCount: rows.length,
      rows,
      warnings: { sitsSkippedForMissingTimestamp: skippedOpportunityIds },
    })
  } catch (e) {
    console.error('GET /api/admin/payroll/export', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
