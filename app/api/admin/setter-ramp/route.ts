import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { isSisuAdminRole } from '@/lib/sisu-admin-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type AuthResult = {
  userId: string
  orgId: string
}

type PostBody = {
  user_id?: unknown
  start_date?: unknown
}

type PatchBody = {
  id?: unknown
  status?: unknown
  notes?: unknown
}

const ELIGIBLE_RAMP_ROLES = new Set(['setter', 'canvasser', 'field_marketer'])
const ENROLLMENT_STATUSES = ['active', 'cancelled']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Resolves the caller once — identity, active check, role and org in a single pass.
 * Replaces a local cookie parser + anon auth client that never checked `users.active`.
 */
async function assertAdmin(): Promise<AuthResult | NextResponse> {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isSisuAdminRole(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!profile.org_id) {
    return NextResponse.json({ error: 'No org found' }, { status: 400 })
  }

  return { userId: profile.id, orgId: profile.org_id }
}

async function readJsonBody(req: NextRequest): Promise<unknown> {
  try {
    return await req.json()
  } catch {
    return null
  }
}

function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime())
}

const ENROLLMENT_SELECT =
  '*, users:users!setter_ramp_enrollments_user_id_fkey(full_name, role), weekly_status:setter_ramp_weekly_status(id, week_number, week_starts_at, week_ends_at, doors_knocked, appointments_set, rolling_avg_appointments, gate_passed, gate_passed_at, commission_total, floor_amount, payout_source, payroll_period_id, bonus_registered)'

export async function GET() {
  const authResult = await assertAdmin()
  if (authResult instanceof NextResponse) return authResult

  const admin = createServiceClient()
  const { data, error } = await admin
    .from('setter_ramp_enrollments')
    .select(ENROLLMENT_SELECT)
    .eq('org_id', authResult.orgId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const enrollments = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
    const weekly = row.weekly_status
    const weeklyArr = Array.isArray(weekly) ? weekly : weekly ? [weekly] : []
    return {
      ...row,
      weekly_status: [...weeklyArr].sort(
        (a, b) => ((a as { week_number: number }).week_number ?? 0) - ((b as { week_number: number }).week_number ?? 0)
      ),
    }
  })

  return NextResponse.json({ enrollments })
}

export async function POST(req: NextRequest) {
  const authResult = await assertAdmin()
  if (authResult instanceof NextResponse) return authResult

  const rawBody = await readJsonBody(req)
  if (!isRecord(rawBody)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const body: PostBody = rawBody
  if (typeof body.user_id !== 'string' || body.user_id.length === 0) {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 })
  }
  if (typeof body.start_date !== 'string' || !isValidDateString(body.start_date)) {
    return NextResponse.json({ error: 'start_date must be YYYY-MM-DD' }, { status: 400 })
  }

  const admin = createServiceClient()

  const { data: targetUser, error: targetUserError } = await admin
    .from('users')
    .select('id, role')
    .eq('id', body.user_id)
    .eq('org_id', authResult.orgId)
    .maybeSingle()

  if (targetUserError) return NextResponse.json({ error: targetUserError.message }, { status: 500 })
  if (!targetUser) return NextResponse.json({ error: 'User not found in your organization' }, { status: 404 })
  if (!targetUser.role || !ELIGIBLE_RAMP_ROLES.has(targetUser.role)) {
    return NextResponse.json(
      { error: 'Only setters, canvassers, and field marketers can be enrolled in the setter ramp program' },
      { status: 400 }
    )
  }

  const { data: activeEnrollment, error: activeCheckError } = await admin
    .from('setter_ramp_enrollments')
    .select('id')
    .eq('org_id', authResult.orgId)
    .eq('user_id', body.user_id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (activeCheckError) return NextResponse.json({ error: activeCheckError.message }, { status: 500 })
  if (activeEnrollment) {
    return NextResponse.json(
      { error: 'This rep already has an active ramp enrollment. Cancel it before enrolling again.' },
      { status: 409 }
    )
  }

  const { data, error } = await admin
    .from('setter_ramp_enrollments')
    .insert({
      org_id: authResult.orgId,
      user_id: body.user_id,
      enrolled_by: authResult.userId,
      start_date: body.start_date,
    })
    .select(ENROLLMENT_SELECT)
    .single()

  if (error) {
    const isDuplicate =
      error.code === '23505' || error.message.toLowerCase().includes('duplicate') || error.message.toLowerCase().includes('unique')
    return NextResponse.json(
      {
        error: isDuplicate
          ? 'An enrollment already exists for this rep on that start date, or they already have an active enrollment.'
          : error.message,
      },
      { status: isDuplicate ? 409 : 500 }
    )
  }
  return NextResponse.json({ enrollment: data })
}

export async function PATCH(req: NextRequest) {
  const authResult = await assertAdmin()
  if (authResult instanceof NextResponse) return authResult

  const rawBody = await readJsonBody(req)
  if (!isRecord(rawBody)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const body: PatchBody = rawBody
  if (typeof body.id !== 'string' || body.id.length === 0) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const updates: Record<string, string | null> = {}

  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !ENROLLMENT_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    updates.status = body.status
  }

  if (body.notes !== undefined) {
    if (body.notes !== null && typeof body.notes !== 'string') {
      return NextResponse.json({ error: 'Invalid notes' }, { status: 400 })
    }
    updates.notes = body.notes
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const admin = createServiceClient()

  if (updates.status === 'active') {
    const { data: target, error: targetError } = await admin
      .from('setter_ramp_enrollments')
      .select('user_id')
      .eq('id', body.id)
      .eq('org_id', authResult.orgId)
      .maybeSingle()

    if (targetError) return NextResponse.json({ error: targetError.message }, { status: 500 })
    if (!target) return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 })

    const { data: otherActive, error: otherActiveError } = await admin
      .from('setter_ramp_enrollments')
      .select('id')
      .eq('org_id', authResult.orgId)
      .eq('user_id', target.user_id)
      .eq('status', 'active')
      .neq('id', body.id)
      .limit(1)
      .maybeSingle()

    if (otherActiveError) return NextResponse.json({ error: otherActiveError.message }, { status: 500 })
    if (otherActive) {
      return NextResponse.json({ error: 'This rep already has another active ramp enrollment.' }, { status: 409 })
    }
  }

  const { data, error } = await admin
    .from('setter_ramp_enrollments')
    .update(updates)
    .eq('id', body.id)
    .eq('org_id', authResult.orgId)
    .select(ENROLLMENT_SELECT)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ enrollment: data })
}
