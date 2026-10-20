import { NextRequest, NextResponse } from 'next/server'

import { partnerApiError, partnerRequestContext } from '@/lib/referral-partner-api'

export const dynamic = 'force-dynamic'

/** Types for the Add Partner form. Everyone reads; admins add / retune / retire. */
export async function GET() {
  try {
    const { supabase, orgId } = await partnerRequestContext()
    const { data, error } = await supabase
      .from('referral_partner_types')
      .select('id, name, sort_order, is_active, inactivity_days')
      .eq('org_id', orgId)
      .order('sort_order')
      .order('name')
    if (error) throw error
    return NextResponse.json({ types: data ?? [] })
  } catch (error) {
    return partnerApiError(error, 'referral-partner-types')
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, orgId, access } = await partnerRequestContext()
    if (!access.canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const name = String(body.name ?? '').trim()
    const inactivityDays = Number(body.inactivity_days ?? 30)
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    if (!Number.isInteger(inactivityDays) || inactivityDays < 8 || inactivityDays > 730) {
      return NextResponse.json({ error: 'Inactivity days must be 8–730' }, { status: 400 })
    }

    if (body.id) {
      const { data: current } = await supabase
        .from('referral_partner_types')
        .select('name')
        .eq('id', body.id)
        .eq('org_id', orgId)
        .maybeSingle()
      if (current?.name.toLowerCase() === 'other' && (name.toLowerCase() !== 'other' || body.is_active === false)) {
        return NextResponse.json({ error: '"Other" can’t be renamed or hidden' }, { status: 400 })
      }
      const patch: Record<string, unknown> = { inactivity_days: inactivityDays, name }
      if (typeof body.is_active === 'boolean') patch.is_active = body.is_active
      const { error } = await supabase
        .from('referral_partner_types')
        .update(patch)
        .eq('id', body.id)
        .eq('org_id', orgId)
      if (error?.code === '23505') {
        return NextResponse.json({ error: 'That type already exists' }, { status: 409 })
      }
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    const { data: last } = await supabase
      .from('referral_partner_types')
      .select('sort_order')
      .eq('org_id', orgId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    const { data, error } = await supabase
      .from('referral_partner_types')
      .insert({
        org_id: orgId,
        name,
        inactivity_days: inactivityDays,
        sort_order: (last?.sort_order ?? 0) + 1,
      })
      .select('id, name, sort_order, is_active, inactivity_days')
      .single()
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'That type already exists' }, { status: 409 })
    }
    if (error) throw error
    return NextResponse.json({ type: data })
  } catch (error) {
    return partnerApiError(error, 'referral-partner-types')
  }
}
