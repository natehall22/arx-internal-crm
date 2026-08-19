/**
 * Admin editor for the org-wide derived commission rates — inspection and
 * self-generated — with full effective-dated history.
 *
 * `manager_override_rate` is accepted but OPTIONAL and defaults to the org's current
 * value, so a caller that omits it carries the column forward untouched. Payroll no
 * longer reads that column at all (override lines come from effective-dated overlay
 * assignments — see lib/job-derived-commission-lines.ts), and the admin UI no longer
 * offers an input for it; the parameter stays only because the RPC signature and the
 * rate-history row both carry the column.
 *
 * This is Phase 1 of docs/prompts/comp-plan-admin-editing.md. It replaces
 * SQL-only edits to `orgs.inspection_commission_rate` etc. with an audited,
 * reason-required RPC (`upsert_org_derived_commission_rates`), while leaving
 * `PATCH /api/admin/payroll/inspection-rate` working as a thin, still-supported
 * shortcut that always writes "as of tomorrow" (see that route for why).
 *
 * Payroll-admin only (`isPayrollAdminRole`). Mirrors the confirm_disable pattern
 * from the inspection-rate route, and adds two more required confirmations that
 * route deliberately didn't need: confirm_backdate (editing history changes what
 * unlocked periods will pay) and, when the chosen date has a later row already
 * scheduled, a later-rows shadow warning (the resolver always picks the latest
 * effective_from <= sale date, so a later row silently wins back control).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { getEasternTodayIso } from '@/lib/eastern-datetime'

export const dynamic = 'force-dynamic'

/** NUMERIC(5,2) holds up to 999.99, but a commission rate above this is a typo, not a plan. */
const MAX_RATE = 25

type RateKey = 'inspection_rate' | 'manager_override_rate' | 'self_gen_rate'

function isYmd(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** Same validation as PATCH /api/admin/payroll/inspection-rate, applied per-field. */
function validateRate(raw: unknown, label: string): { rate: number } | { error: string } {
  const value = typeof raw === 'string' ? raw.trim() : raw
  if (value === '' || value == null) return { error: `${label} is required` }
  const rate = Number(value)
  if (!Number.isFinite(rate)) return { error: `${label} must be a number` }
  if (rate < 0) return { error: `${label} cannot be negative` }
  if (rate > MAX_RATE) return { error: `${label} cannot exceed ${MAX_RATE}% — check for a typo` }
  if (Math.round(rate * 100) !== rate * 100) {
    return { error: `${label} supports at most 2 decimal places (e.g. 1.50)` }
  }
  return { rate }
}

async function requirePayrollAdmin() {
  const ctx = await requireAuthApi()
  if (!isPayrollAdminRole(ctx.profile.role)) return null
  return ctx
}

export async function GET() {
  let auth
  try {
    auth = await requirePayrollAdmin()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const supabase = createServiceClient()
    const orgId = auth.profile.org_id

    const [{ data: history, error: historyError }, { data: org, error: orgError }] = await Promise.all([
      supabase
        .from('org_derived_commission_rates')
        .select(
          'id, effective_from, inspection_commission_rate, manager_override_commission_rate, self_gen_commission_rate, change_reason, created_by_user_id, created_at, users:created_by_user_id(full_name, email)'
        )
        .eq('org_id', orgId)
        .order('effective_from', { ascending: true }),
      supabase
        .from('orgs')
        .select('inspection_commission_rate, manager_override_commission_rate, self_gen_commission_rate')
        .eq('id', orgId)
        .maybeSingle(),
    ])

    if (historyError || orgError) {
      console.error('comp-rates GET', historyError || orgError)
      return NextResponse.json({ error: 'Failed to load commission rates' }, { status: 500 })
    }

    const today = getEasternTodayIso()

    // Exactly one row is in effect: the LATEST one dated on or before today. Every
    // earlier row is superseded history, and every later row is scheduled but not
    // yet live. Matches resolveDerivedCommissionRatesForSaleDate's own rule.
    const inEffectFrom = (history || [])
      .map((row: Record<string, unknown>) => row.effective_from as string)
      .filter((from) => from <= today)
      .sort()
      .pop() ?? null

    return NextResponse.json({
      today,
      current: {
        inspectionRate: Number(org?.inspection_commission_rate) || 0,
        managerOverrideRate: Number(org?.manager_override_commission_rate) || 0,
        selfGenRate: Number(org?.self_gen_commission_rate) || 0,
      },
      history: (history || []).map((row: Record<string, unknown>) => {
        const changedBy = Array.isArray(row.users) ? row.users[0] : row.users
        return {
          id: row.id,
          effectiveFrom: row.effective_from,
          inspectionRate: Number(row.inspection_commission_rate) || 0,
          managerOverrideRate: Number(row.manager_override_commission_rate) || 0,
          selfGenRate: Number(row.self_gen_commission_rate) || 0,
          changeReason: row.change_reason ?? null,
          changedByUserId: row.created_by_user_id ?? null,
          changedByName:
            (changedBy as { full_name?: string; email?: string } | null)?.full_name ||
            (changedBy as { full_name?: string; email?: string } | null)?.email ||
            null,
          createdAt: row.created_at,
          isCurrent: (row.effective_from as string) === inEffectFrom,
          isScheduled: (row.effective_from as string) > today,
        }
      }),
      maxRate: MAX_RATE,
    })
  } catch (e) {
    console.error('comp-rates GET', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  let auth
  try {
    auth = await requirePayrollAdmin()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!auth) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const body = (await request.json().catch(() => ({}))) as {
      inspection_rate?: unknown
      manager_override_rate?: unknown
      self_gen_rate?: unknown
      effective_from?: unknown
      change_reason?: unknown
      confirm_disable?: unknown
      confirm_backdate?: unknown
      apply_to_later_rows?: unknown
    }

    const fields: Record<RateKey, { label: string }> = {
      inspection_rate: { label: 'Inspection rate' },
      manager_override_rate: { label: 'Manager override rate' },
      self_gen_rate: { label: 'Self-generated rate' },
    }

    const rates: Partial<Record<RateKey, number>> = {}
    for (const key of Object.keys(fields) as RateKey[]) {
      // Only the manager override may be omitted; it is carried forward below.
      if (key === 'manager_override_rate' && body[key] === undefined) continue
      const result = validateRate(body[key], fields[key].label)
      if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
      rates[key] = result.rate
    }

    if (!isYmd(body.effective_from)) {
      return NextResponse.json({ error: 'A valid effective date is required' }, { status: 400 })
    }
    const effectiveFrom = body.effective_from as string

    const reason = typeof body.change_reason === 'string' ? body.change_reason.trim() : ''
    if (!reason) {
      return NextResponse.json({ error: 'A change reason is required for payroll history.' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const orgId = auth.profile.org_id

    // 1. Disabling a currently-nonzero line switches it off for the whole org —
    //    never accept that silently. Compare against the org's CURRENT values,
    //    which is what the UI shows next to each input.
    const { data: currentOrg, error: currentOrgError } = await supabase
      .from('orgs')
      .select('inspection_commission_rate, manager_override_commission_rate, self_gen_commission_rate')
      .eq('id', orgId)
      .maybeSingle()
    if (currentOrgError) {
      console.error('comp-rates POST (load current)', currentOrgError)
      return NextResponse.json({ error: 'Failed to load current rates' }, { status: 500 })
    }

    const currentValues: Record<RateKey, number> = {
      inspection_rate: Number(currentOrg?.inspection_commission_rate) || 0,
      manager_override_rate: Number(currentOrg?.manager_override_commission_rate) || 0,
      self_gen_rate: Number(currentOrg?.self_gen_commission_rate) || 0,
    }
    // An omitted manager override keeps whatever is already stored, so the write can
    // never turn a value off by silence. The RPC upserts on (org_id, effective_from),
    // so the value to carry forward is the one on THAT row when it already exists —
    // using the org's current value instead would overwrite a scheduled row's override
    // with today's whenever an admin edits only the other two rates.
    if (rates.manager_override_rate === undefined) {
      const { data: rowForDate, error: rowForDateError } = await supabase
        .from('org_derived_commission_rates')
        .select('manager_override_commission_rate')
        .eq('org_id', orgId)
        .eq('effective_from', effectiveFrom)
        .maybeSingle()
      if (rowForDateError) {
        console.error('comp-rates POST (row for date)', rowForDateError)
        return NextResponse.json({ error: 'Failed to load current rates' }, { status: 500 })
      }
      rates.manager_override_rate = rowForDate
        ? Number(rowForDate.manager_override_commission_rate) || 0
        : currentValues.manager_override_rate
    }
    const resolvedRates = rates as Record<RateKey, number>

    const disabling = (Object.keys(fields) as RateKey[]).filter(
      (key) => currentValues[key] > 0 && resolvedRates[key] === 0
    )
    if (disabling.length > 0 && body.confirm_disable !== true) {
      return NextResponse.json(
        {
          error:
            `Setting ${disabling.map((k) => fields[k].label.toLowerCase()).join(', ')} to 0 turns ` +
            'that commission off for the whole org. Confirm the change to continue.',
          code: 'confirm_disable_required',
          fields: disabling,
        },
        { status: 400 }
      )
    }

    // 2. Backdating rewrites what unlocked periods will pay. Require an explicit
    //    acknowledgement rather than inferring intent from the date picker.
    const today = getEasternTodayIso()
    if (effectiveFrom < today && body.confirm_backdate !== true) {
      return NextResponse.json(
        {
          error:
            `${effectiveFrom} is in the past. Backdating changes what already-open payroll ` +
            'periods will pay. Confirm the change to continue.',
          code: 'confirm_backdate_required',
        },
        { status: 400 }
      )
    }

    // 3. Settled history is not editable, full stop. payroll_periods has NO period-
    //    start column — materializePayrollPeriod (lib/payroll-period-materialization.ts
    //    ~line 186) sweeps up every previously-unpaid eligible job with
    //    sale_date <= period.cutoff_at, unbounded below — so a period does not
    //    "cover" a range, it only bounds sale dates from above. A rate change can
    //    therefore only be judged against the single highest cutoff_at among
    //    already-settled (locked/paid) periods: if effective_from reaches back to
    //    or before that date, some already-paid job's pay could be affected.
    //    Status values verified against the live CHECK constraint on payroll_periods:
    //    'open' | 'locked' | 'paid' | 'cancelled'.
    const { data: settledPeriods, error: periodsError } = await supabase
      .from('payroll_periods')
      .select('id, period_label, cutoff_at, status')
      .eq('org_id', orgId)
      .in('status', ['locked', 'paid'])
    if (periodsError) {
      console.error('comp-rates POST (periods)', periodsError)
      return NextResponse.json({ error: 'Failed to check payroll periods' }, { status: 500 })
    }
    const newestSettled = (settledPeriods || [])
      .slice()
      .sort((a, b) => (a.cutoff_at < b.cutoff_at ? 1 : -1))[0]
    if (newestSettled && effectiveFrom <= newestSettled.cutoff_at.slice(0, 10)) {
      return NextResponse.json(
        {
          error:
            `Payroll period "${newestSettled.period_label}" is already ${newestSettled.status} ` +
            `through ${newestSettled.cutoff_at.slice(0, 10)}. ${effectiveFrom} reaches back to or ` +
            'before that date, which could change what an already-settled job pays. Choose a later effective date.',
          code: 'locked_period',
          period: {
            id: newestSettled.id,
            label: newestSettled.period_label,
            status: newestSettled.status,
            cutoffDate: newestSettled.cutoff_at.slice(0, 10),
          },
        },
        { status: 400 }
      )
    }

    // 4. The resolver always picks the LATEST row with effective_from <= sale date.
    //    A row already scheduled after the date the admin is about to save will
    //    silently take back over from its own date forward. Surface every such row
    //    and require an explicit choice before writing anything.
    const { data: laterRows, error: laterRowsError } = await supabase
      .from('org_derived_commission_rates')
      .select(
        'effective_from, inspection_commission_rate, manager_override_commission_rate, self_gen_commission_rate'
      )
      .eq('org_id', orgId)
      .gt('effective_from', effectiveFrom)
      .order('effective_from', { ascending: true })
    if (laterRowsError) {
      console.error('comp-rates POST (later rows)', laterRowsError)
      return NextResponse.json({ error: 'Failed to check later scheduled rates' }, { status: 500 })
    }
    const hasLaterRows = (laterRows || []).length > 0
    const applyToLaterRows = body.apply_to_later_rows === true
    if (hasLaterRows && typeof body.apply_to_later_rows !== 'boolean') {
      return NextResponse.json(
        {
          error:
            `${laterRows!.length} later rate change(s) already scheduled after ${effectiveFrom} ` +
            'will take over from their own date forward unless you also update them. Choose whether ' +
            'to apply these new rates to those rows too.',
          code: 'later_rows_shadow_warning',
          laterRows: (laterRows || []).map((row) => ({
            effectiveFrom: row.effective_from,
            inspectionRate: Number(row.inspection_commission_rate) || 0,
            managerOverrideRate: Number(row.manager_override_commission_rate) || 0,
            selfGenRate: Number(row.self_gen_commission_rate) || 0,
          })),
        },
        { status: 400 }
      )
    }

    const { error } = await supabase.rpc('upsert_org_derived_commission_rates', {
      p_org_id: orgId,
      p_inspection: resolvedRates.inspection_rate,
      p_manager_override: resolvedRates.manager_override_rate,
      p_self_gen: resolvedRates.self_gen_rate,
      p_effective_from: effectiveFrom,
      p_created_by_user_id: auth.authUser.id,
      p_change_reason: reason,
      p_apply_to_later_rows: applyToLaterRows,
    })

    if (error) {
      console.error('comp-rates POST (rpc)', error)
      return NextResponse.json({ error: error.message || 'Failed to save commission rates' }, { status: 400 })
    }

    return NextResponse.json({ success: true, appliedToLaterRows: applyToLaterRows })
  } catch (e) {
    console.error('comp-rates POST', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
