import { NextRequest, NextResponse } from 'next/server'

import { partnerApiError, partnerRequestContext } from '@/lib/referral-partner-api'
import { loadReferredJobs } from '@/lib/referral-partner-stats'
import {
  PARTNER_SELECT,
  canWorkPartner,
  daysUntilOpen,
  normalizePartnerPhone,
  redactPartner,
  type ReferralPartnerRow,
} from '@/lib/referral-partners'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

async function loadPartner(
  supabase: Awaited<ReturnType<typeof partnerRequestContext>>['supabase'],
  orgId: string,
  id: string
) {
  const { data } = await supabase
    .from('referral_partners')
    .select(PARTNER_SELECT)
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle()
  return (data as unknown as ReferralPartnerRow | null) ?? null
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const { supabase, userId, orgId, access } = await partnerRequestContext()
    const partner = await loadPartner(supabase, orgId, params.id)
    if (!partner) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [touches, stats, log] = await Promise.all([
      supabase
        .from('activities')
        .select('id, type, body, created_at, user:users!activities_user_id_fkey(full_name)')
        .eq('referral_partner_id', partner.id)
        .order('created_at', { ascending: false })
        .limit(30),
      loadReferredJobs(supabase, orgId, [partner.id]),
      access.canManage || partner.assigned_user_id === userId
        ? supabase
            .from('referral_partner_assignment_log')
            .select(
              'id, created_at, reason, to_status, to_user:users!referral_partner_assignment_log_to_user_id_fkey(full_name), by:users!referral_partner_assignment_log_changed_by_fkey(full_name)'
            )
            .eq('partner_id', partner.id)
            .order('created_at', { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] }),
    ])

    const canSee = canWorkPartner(partner, userId, access)
    return NextResponse.json({
      partner: {
        ...redactPartner(partner, userId, access),
        days_until_open: daysUntilOpen(partner),
        is_mine: partner.assigned_user_id === userId,
      },
      can_work: canWorkPartner(partner, userId, access),
      can_manage: access.canManage,
      touches: canSee ? (touches.data ?? []) : [],
      assignment_log: log.data ?? [],
      referred_count: stats.referredCount.get(partner.id) ?? 0,
      jobs_sold: stats.jobs.length,
      revenue_sold: stats.jobs.reduce((sum, j) => sum + j.sale_amount, 0),
    })
  } catch (error) {
    return partnerApiError(error, 'referral-partners detail')
  }
}

/** Edit details: the assigned rep or an admin. Assignment and status never change here. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { supabase, userId, orgId, access } = await partnerRequestContext()
    const partner = await loadPartner(supabase, orgId, params.id)
    if (!partner) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!canWorkPartner(partner, userId, access)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const patch: Record<string, unknown> = {}
    const text = (v: unknown) => {
      const s = String(v ?? '').trim()
      return s || null
    }
    if ('name' in body) {
      const name = String(body.name ?? '').trim()
      if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
      patch.name = name
    }
    if ('phone' in body && (String(body.phone ?? '').trim() || partner.phone)) {
      const digits = normalizePartnerPhone(body.phone)
      if (!digits || digits.length < 7) {
        return NextResponse.json({ error: 'Enter a phone number' }, { status: 400 })
      }
      patch.phone = String(body.phone).trim()
    }
    for (const key of ['email', 'company', 'notes', 'other_type_text'] as const) {
      if (key in body) patch[key] = text(body[key])
    }
    if ('type_id' in body) {
      const { data: type } = await supabase
        .from('referral_partner_types')
        .select('id')
        .eq('id', body.type_id)
        .eq('org_id', orgId)
        .maybeSingle()
      if (!type) return NextResponse.json({ error: 'Pick a type' }, { status: 400 })
      patch.type_id = type.id
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const { error } = await supabase
      .from('referral_partners')
      .update(patch)
      .eq('id', partner.id)
      .eq('org_id', orgId)
    if (error?.code === '23505') {
      const { data: owner } = await supabase
        .from('referral_partners')
        .select(PARTNER_SELECT)
        .eq('org_id', orgId)
        .eq('phone_digits', normalizePartnerPhone(String(patch.phone)))
        .maybeSingle()
      return NextResponse.json(
        { error: 'exists', partner: owner ? redactPartner(owner as unknown as ReferralPartnerRow, userId, access) : null },
        { status: 409 }
      )
    }
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    return partnerApiError(error, 'referral-partners update')
  }
}
