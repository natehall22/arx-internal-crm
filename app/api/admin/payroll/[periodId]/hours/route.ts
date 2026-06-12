import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { loadActiveCompPlanForUser } from '@/lib/payroll-export'
import { resolveHourlyRate } from '@/lib/payroll-hourly-rate'
import { computeHourlyEarnings } from '@/lib/weekly-payroll/hourly-earnings'
import type { CompPlanForCalc } from '@/lib/calculate-commission-from-plan'

export const dynamic = 'force-dynamic'

type HoursEntry = {
  user_id: string
  regular_hours: number
  overtime_hours: number
  notes?: string | null
  reason?: string | null
}

function isHourlyEligiblePlan(
  plan: (CompPlanForCalc & { hourly_rate?: number | null }) | null | undefined,
  hourlyRateOverride: number | null | undefined
): boolean {
  const pt = String(plan?.plan_type || '').toLowerCase()
  if (pt === 'hourly' || pt === 'hybrid') return true
  if (resolveHourlyRate({ hourlyRateOverride, compPlan: plan }) != null) return true
  return false
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { periodId: string } }
) {
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

    const supabase = createServiceClient()
    const orgId = profile.org_id
    const periodId = params.periodId

    const { data: period, error: periodErr } = await supabase
      .from('payroll_periods')
      .select(
        'id, period_label, cutoff_at, scheduled_pay_date, status, locked_at, paid_at'
      )
      .eq('id', periodId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (periodErr || !period) {
      return NextResponse.json({ error: 'Period not found' }, { status: 404 })
    }

    const saleDate = period.cutoff_at
      ? String(period.cutoff_at).slice(0, 10)
      : new Date().toISOString().slice(0, 10)

    const [{ data: users }, { data: savedRows }] = await Promise.all([
      supabase
        .from('users')
        .select('id, full_name, role')
        .eq('org_id', orgId)
        .eq('active', true)
        .order('full_name'),
      supabase
        .from('payroll_rep_hours')
        .select(
          'user_id, regular_hours, overtime_hours, hourly_rate_snapshot, hourly_earnings, notes, locked_at'
        )
        .eq('payroll_period_id', periodId)
        .eq('org_id', orgId),
    ])

    const savedByUser = new Map((savedRows || []).map((r) => [r.user_id as string, r]))

    const rows: Array<{
      user_id: string
      full_name: string
      role: string
      plan_name: string | null
      plan_type: string | null
      hourly_rate: number | null
      regular_hours: number
      overtime_hours: number
      hourly_earnings: number
      notes: string | null
    }> = []

    for (const u of users || []) {
      const assignment = await loadActiveCompPlanForUser(
        supabase,
        u.id as string,
        orgId,
        saleDate
      )
      const plan = assignment?.comp_plans as (CompPlanForCalc & {
        hourly_rate?: number | null
        name?: string | null
      }) | null
      if (!isHourlyEligiblePlan(plan, assignment?.hourly_rate_override)) continue

      const hourlyRate = resolveHourlyRate({
        hourlyRateOverride: assignment?.hourly_rate_override,
        compPlan: plan,
      })
      const saved = savedByUser.get(u.id as string)
      const reg = Number(saved?.regular_hours) || 0
      const ot = Number(saved?.overtime_hours) || 0
      const rate = hourlyRate ?? (Number(saved?.hourly_rate_snapshot) || 0)
      const earnings =
        saved?.hourly_earnings != null
          ? Number(saved.hourly_earnings)
          : computeHourlyEarnings({ regularHours: reg, overtimeHours: ot, hourlyRate: rate }).total

      rows.push({
        user_id: u.id as string,
        full_name: (u.full_name as string) || (u.id as string),
        role: u.role as string,
        plan_name: plan?.name ?? null,
        plan_type: plan?.plan_type ?? null,
        hourly_rate: rate,
        regular_hours: reg,
        overtime_hours: ot,
        hourly_earnings: earnings,
        notes: (saved?.notes as string) ?? null,
      })
    }

    const readOnly =
      period.status === 'locked' || period.status === 'paid' || Boolean(period.locked_at)

    return NextResponse.json({ period, readOnly, rows })
  } catch (e) {
    console.error('GET admin/payroll hours', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { periodId: string } }
) {
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

    const periodId = params.periodId
    const body = (await request.json()) as { entries?: HoursEntry[] }
    const entries = body.entries
    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ error: 'entries array is required' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const orgId = profile.org_id

    const { data: period, error: periodErr } = await supabase
      .from('payroll_periods')
      .select('id, status, locked_at')
      .eq('id', periodId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (periodErr || !period) {
      return NextResponse.json({ error: 'Period not found' }, { status: 404 })
    }
    if (period.status === 'locked' || period.status === 'paid' || period.locked_at) {
      return NextResponse.json({ error: 'Period is locked' }, { status: 409 })
    }

    const { data: periodMeta } = await supabase
      .from('payroll_periods')
      .select('cutoff_at')
      .eq('id', periodId)
      .single()
    const saleDate = periodMeta?.cutoff_at
      ? String(periodMeta.cutoff_at).slice(0, 10)
      : new Date().toISOString().slice(0, 10)

    const results: { user_id: string; id: string }[] = []

    for (const entry of entries) {
      const userId = entry.user_id
      if (!userId) continue

      const reg = Math.max(0, Number(entry.regular_hours) || 0)
      const ot = Math.max(0, Number(entry.overtime_hours) || 0)

      const assignment = await loadActiveCompPlanForUser(supabase, userId, orgId, saleDate)
      const plan = assignment?.comp_plans as (CompPlanForCalc & { hourly_rate?: number | null }) | null
      const hourlyRate = resolveHourlyRate({
        hourlyRateOverride: assignment?.hourly_rate_override,
        compPlan: plan,
      })
      // Only require a resolved hourly rate when actual hours are being recorded.
      // Commission-only reps (no hourly component) may appear on the entry table
      // but should not block saving when their hours are zero.
      if (hourlyRate == null && (reg > 0 || ot > 0)) {
        return NextResponse.json(
          { error: `No hourly rate for user ${userId}` },
          { status: 400 }
        )
      }
      const earnings = computeHourlyEarnings({
        regularHours: reg,
        overtimeHours: ot,
        hourlyRate: hourlyRate ?? 0,
      })

      const { data: existing } = await supabase
        .from('payroll_rep_hours')
        .select('id, regular_hours, overtime_hours, notes, hourly_rate_snapshot, hourly_earnings')
        .eq('payroll_period_id', periodId)
        .eq('user_id', userId)
        .maybeSingle()

      const upsertPayload = {
        org_id: orgId,
        payroll_period_id: periodId,
        user_id: userId,
        regular_hours: reg,
        overtime_hours: ot,
        hourly_rate_snapshot: hourlyRate,
        hourly_earnings: earnings.total,
        notes: entry.notes ?? null,
      }

      const { data: saved, error: saveErr } = await supabase
        .from('payroll_rep_hours')
        .upsert(upsertPayload, { onConflict: 'payroll_period_id,user_id' })
        .select('id')
        .single()

      if (saveErr || !saved) {
        console.error('payroll_rep_hours upsert', saveErr)
        return NextResponse.json({ error: 'Failed to save hours' }, { status: 500 })
      }

      const auditReason = entry.reason || 'Admin hours entry'
      const fields: Array<{
        field: string
        oldVal: string | null
        newVal: string
      }> = [
        { field: 'regular_hours', oldVal: existing?.regular_hours?.toString() ?? null, newVal: String(reg) },
        { field: 'overtime_hours', oldVal: existing?.overtime_hours?.toString() ?? null, newVal: String(ot) },
        {
          field: 'hourly_earnings',
          oldVal: existing?.hourly_earnings?.toString() ?? null,
          newVal: String(earnings.total),
        },
      ]
      if (entry.notes !== undefined) {
        fields.push({
          field: 'notes',
          oldVal: (existing?.notes as string) ?? null,
          newVal: entry.notes ?? '',
        })
      }

      for (const f of fields) {
        if (f.oldVal === f.newVal) continue
        await supabase.from('payroll_rep_hours_audit').insert({
          org_id: orgId,
          rep_hours_id: saved.id,
          payroll_period_id: periodId,
          user_id: userId,
          actor_user_id: profile.id,
          field_changed: f.field,
          old_value: f.oldVal,
          new_value: f.newVal,
          reason: auditReason,
        })
      }

      results.push({ user_id: userId, id: saved.id as string })
    }

    return NextResponse.json({ saved: results })
  } catch (e) {
    console.error('admin/payroll hours', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
