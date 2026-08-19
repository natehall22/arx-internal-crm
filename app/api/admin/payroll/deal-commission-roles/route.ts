import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'

export const dynamic = 'force-dynamic'

/** Mirrors the deal_commission_roles role CHECK constraint. */
const STORAGE_ROLES = new Set([
  'setter',
  'closer',
  'inspector',
  'field_manager',
  'senior_manager',
  'setter_manager_override',
  'closer_manager_override',
  'self_gen',
  'custom',
])

/** Statement/payout role names that map onto a storage role. */
const ROLE_MAP: Record<string, string> = {
  owner: 'closer',
  sales_rep: 'closer',
}

export async function PATCH(request: NextRequest) {
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

    const body = (await request.json()) as {
      job_id?: string
      user_id?: string
      role?: string
      override_amount?: number | null
      override_percent?: number | null
      reason?: string
    }

    if (!body.job_id || !body.user_id || !body.role) {
      return NextResponse.json(
        { error: 'job_id, user_id, and role are required' },
        { status: 400 }
      )
    }

    // A commission override changes what someone gets paid. A blank reason must
    // never silently become a meaningless default — matches the overlay RPCs
    // (assign_management_comp_overlay etc.), which RAISE EXCEPTION on empty reason.
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) {
      return NextResponse.json(
        { error: 'A change reason is required to save a commission override.' },
        { status: 400 }
      )
    }

    const storageRole = ROLE_MAP[body.role] || body.role
    if (!STORAGE_ROLES.has(storageRole)) {
      return NextResponse.json(
        { error: `Unsupported role "${body.role}"` },
        { status: 400 }
      )
    }

    // Which fields the caller actually intends to change. Absent keys are left
    // alone; present keys are written (including an explicit null to clear).
    const hasAmount = Object.prototype.hasOwnProperty.call(body, 'override_amount')
    const hasPercent = Object.prototype.hasOwnProperty.call(body, 'override_percent')
    if (!hasAmount && !hasPercent) {
      return NextResponse.json(
        { error: 'override_amount or override_percent is required' },
        { status: 400 }
      )
    }

    let overrideAmount: number | null = null
    if (hasAmount && body.override_amount != null) {
      const n = Number(body.override_amount)
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json(
          { error: 'override_amount must be a non-negative number' },
          { status: 400 }
        )
      }
      overrideAmount = n
    }

    let overridePercent: number | null = null
    if (hasPercent && body.override_percent != null) {
      const n = Number(body.override_percent)
      // NUMERIC(5,2) holds up to 999.99, but a commission rate above 100% of the
      // job base is always a typo, so reject it here rather than paying it.
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return NextResponse.json(
          { error: 'override_percent must be between 0 and 100' },
          { status: 400 }
        )
      }
      overridePercent = n
    }

    const supabase = createServiceClient()
    const orgId = profile.org_id

    const { data: job } = await supabase
      .from('production_jobs')
      .select('id')
      .eq('id', body.job_id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Settled history is not editable — but "settled" has to mean this job's pay was
    // actually paid out, not merely that its sale date is old. payroll_periods has no
    // start column and materializePayrollPeriod sweeps every previously-unpaid eligible
    // job with sale_date <= cutoff_at (no lower bound), so comparing a sale date to the
    // newest settled cutoff would also block jobs that were never paid at all — as of
    // 2026-08-19 that is 26 prod jobs with zero payout lines. Those still need to be
    // overridable, because a future period will sweep them up and pay them.
    //
    // The precise question is therefore: does this job already have payout lines in a
    // locked or paid period? If so its pay is settled and an override would disagree
    // with what was paid; if not, the job is still ahead of payroll.
    const { data: paidLines, error: paidLinesError } = await supabase
      .from('payroll_payout_lines')
      .select('id, payroll_period_id, payroll_periods!inner(id, period_label, status)')
      .eq('org_id', orgId)
      .eq('job_id', body.job_id)
      .in('payroll_periods.status', ['locked', 'paid'])
      .limit(1)
    if (paidLinesError) {
      console.error('deal-commission-roles PATCH (settled payout lines)', paidLinesError)
      return NextResponse.json({ error: 'Failed to check payroll periods' }, { status: 500 })
    }
    const settledLine = (paidLines || [])[0] as
      | { payroll_periods?: { period_label?: string; status?: string } | Array<{ period_label?: string; status?: string }> }
      | undefined
    if (settledLine) {
      const period = Array.isArray(settledLine.payroll_periods)
        ? settledLine.payroll_periods[0]
        : settledLine.payroll_periods
      return NextResponse.json(
        {
          error:
            `This job was already paid in payroll period "${period?.period_label ?? 'unknown'}" ` +
            `(${period?.status ?? 'settled'}). Overrides on settled pay are not allowed — ` +
            'adjust it on the next period instead.',
          code: 'locked_period',
          period: { label: period?.period_label ?? null, status: period?.status ?? null },
        },
        { status: 400 }
      )
    }

    // The row is org-scoped, but the user it credits must belong to this org too —
    // otherwise payroll could be pointed at a user outside the caller's tenant.
    const { data: targetUser } = await supabase
      .from('users')
      .select('id')
      .eq('id', body.user_id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found in your organization' }, { status: 404 })
    }

    const { data: existing } = await supabase
      .from('deal_commission_roles')
      .select('id, override_amount, override_percent')
      .eq('job_id', body.job_id)
      .eq('user_id', body.user_id)
      .eq('role', storageRole)
      .eq('org_id', orgId)
      .maybeSingle()

    // Flat dollars and percent are alternatives, not additive — resolveAdditiveParticipantAmount()
    // pays the flat amount and ignores the percent when both are set. Clearing the
    // counterpart keeps the stored row honest about which one is actually paying.
    const changes: { override_amount?: number | null; override_percent?: number | null } = {}
    if (hasAmount) {
      changes.override_amount = overrideAmount
      if (overrideAmount != null) changes.override_percent = null
    }
    if (hasPercent) {
      changes.override_percent = overridePercent
      if (overridePercent != null) changes.override_amount = null
    }

    const returning = 'id, job_id, user_id, role, override_amount, override_percent'
    const { data: saved, error } = existing
      ? await supabase
          .from('deal_commission_roles')
          .update(changes)
          .eq('id', existing.id)
          .select(returning)
          .single()
      : await supabase
          .from('deal_commission_roles')
          .insert({
            org_id: orgId,
            job_id: body.job_id,
            user_id: body.user_id,
            role: storageRole,
            override_amount: changes.override_amount ?? null,
            override_percent: changes.override_percent ?? null,
          })
          .select(returning)
          .single()

    if (error || !saved) {
      console.error('deal_commission_roles', error)
      return NextResponse.json({ error: 'Failed to save override' }, { status: 500 })
    }

    // The audit row is stored alongside user_id (in addition to job_id + role) so
    // the read-only register (GET below) can match an override to its audit trail
    // unambiguously even when two different users hold the same role on a job.
    const { error: auditError } = await supabase.from('payroll_override_audit').insert({
      org_id: orgId,
      override_type: 'manual_adjustment',
      job_id: body.job_id,
      actor_user_id: profile.id,
      reason,
      before_value: {
        override_amount: existing?.override_amount ?? null,
        override_percent: existing?.override_percent ?? null,
        role: storageRole,
        user_id: body.user_id,
      },
      after_value: {
        override_amount: saved.override_amount,
        override_percent: saved.override_percent,
        role: storageRole,
        user_id: body.user_id,
      },
    })

    if (auditError) {
      // A payroll-affecting change must never stand unaudited. The write above
      // and this insert aren't in a single transaction (no RPC), so on failure
      // here we compensate by rolling the override back to its pre-write state
      // and 500ing, rather than letting an unaudited override silently persist.
      console.error('deal_commission_roles audit insert failed — rolling back override', auditError)
      const { error: rollbackError } = existing
        ? await supabase
            .from('deal_commission_roles')
            .update({
              override_amount: existing.override_amount,
              override_percent: existing.override_percent,
            })
            .eq('id', existing.id)
        : await supabase.from('deal_commission_roles').delete().eq('id', saved.id)

      if (rollbackError) {
        // Worst case: audit failed AND rollback failed. Log loudly — this is the
        // one scenario the design can't fully prevent without a transaction —
        // but never report success back to the caller.
        console.error('deal_commission_roles rollback ALSO failed — override may be unaudited', {
          rollbackError,
          savedId: saved.id,
        })
      }

      return NextResponse.json(
        { error: 'Failed to record the audit trail for this change. The override was not saved.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ role: saved })
  } catch (e) {
    console.error('PATCH deal-commission-roles', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

type AuditJsonValue = { override_amount?: number | null; override_percent?: number | null; role?: string; user_id?: string } | null

/**
 * Read-only, org-wide register of every deal_commission_roles row, joined to the
 * latest matching payroll_override_audit row for actor/reason/when. This is the
 * only read surface for overrides today — editing stays on the statement page
 * (PATCH above), so there remains exactly one write path.
 *
 * The join is best-effort: payroll_override_audit doesn't have role/user_id
 * columns, only job_id — role and (since this change) user_id live inside the
 * before_value/after_value jsonb. Older audit rows written before this change
 * don't carry user_id, so those match on job_id + role alone.
 */
export async function GET() {
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

    const { data: overrides, error } = await supabase
      .from('deal_commission_roles')
      .select(
        'id, job_id, role, user_id, override_amount, override_percent, premier_pricing_amount, created_at, updated_at, ' +
          'job:production_jobs(id, job_number, sale_date), user:users(id, full_name, email)'
      )
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })

    if (error) {
      console.error('GET deal-commission-roles', error)
      return NextResponse.json({ error: 'Failed to load overrides' }, { status: 500 })
    }

    const rows = (overrides || []) as unknown as Record<string, unknown>[]
    const jobIds = Array.from(new Set(rows.map((row) => row.job_id as string).filter(Boolean)))

    const { data: auditRows, error: auditError } = jobIds.length
      ? await supabase
          .from('payroll_override_audit')
          .select('id, job_id, actor_user_id, reason, before_value, after_value, created_at, actor:users(full_name, email)')
          .eq('org_id', orgId)
          .eq('override_type', 'manual_adjustment')
          .in('job_id', jobIds)
          .order('created_at', { ascending: false })
      : { data: [] as Array<Record<string, unknown>>, error: null }

    if (auditError) {
      // Non-fatal: the overrides themselves are still useful without audit context.
      console.error('GET deal-commission-roles (audit)', auditError)
    }

    const audits = (auditRows || []) as unknown as Record<string, unknown>[]

    const result = rows.map((row) => {
      const job = Array.isArray(row.job) ? row.job[0] : row.job
      const user = Array.isArray(row.user) ? row.user[0] : row.user

      // Prefer an audit row whose after_value names this exact user; fall back to
      // job_id + role only for legacy rows written before user_id was captured.
      const roleMatches = audits.filter((a) => {
        if (a.job_id !== row.job_id) return false
        const after = a.after_value as AuditJsonValue
        return !!after && after.role === row.role
      })
      const matchingAudit =
        roleMatches.find((a) => (a.after_value as AuditJsonValue)?.user_id === row.user_id) ||
        roleMatches.find((a) => (a.after_value as AuditJsonValue)?.user_id == null) ||
        null

      const actor = matchingAudit ? (Array.isArray(matchingAudit.actor) ? matchingAudit.actor[0] : matchingAudit.actor) : null

      return {
        id: row.id,
        jobId: row.job_id,
        jobNumber: (job as { job_number?: string } | null)?.job_number ?? null,
        saleDate: (job as { sale_date?: string } | null)?.sale_date ?? null,
        role: row.role,
        userId: row.user_id,
        userName:
          (user as { full_name?: string; email?: string } | null)?.full_name ||
          (user as { full_name?: string; email?: string } | null)?.email ||
          null,
        overrideAmount: row.override_amount,
        overridePercent: row.override_percent,
        premierPricingAmount: row.premier_pricing_amount,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        audit: matchingAudit
          ? {
              actorUserId: matchingAudit.actor_user_id,
              actorName:
                (actor as { full_name?: string; email?: string } | null)?.full_name ||
                (actor as { full_name?: string; email?: string } | null)?.email ||
                null,
              reason: matchingAudit.reason,
              createdAt: matchingAudit.created_at,
            }
          : null,
      }
    })

    return NextResponse.json({ overrides: result })
  } catch (e) {
    console.error('GET deal-commission-roles', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
