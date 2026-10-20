import { NextRequest, NextResponse } from 'next/server'

import { partnerApiError, partnerRequestContext } from '@/lib/referral-partner-api'
import {
  PARTNER_SELECT,
  daysUntilOpen,
  redactPartner,
  normalizePartnerPhone,
  safeLikeTerm,
  type ReferralPartnerRow,
} from '@/lib/referral-partners'

export const dynamic = 'force-dynamic'

const LIST_LIMIT = 50

/**
 * Search-first list. `q` matches the first letters of name / company or the first digits
 * of a phone; when that finds little, near-spellings are appended (pg_trgm) so a rep sees
 * "Jon Smith" before adding "John Smith". scope: mine | all | open (default all).
 */
export async function GET(request: NextRequest) {
  try {
    const { supabase, userId, orgId, access } = await partnerRequestContext()
    const q = safeLikeTerm(request.nextUrl.searchParams.get('q') ?? '')
    const scope = request.nextUrl.searchParams.get('scope') ?? 'all'

    let query = supabase
      .from('referral_partners')
      .select(PARTNER_SELECT)
      .eq('org_id', orgId)
      .order('name')
      .limit(LIST_LIMIT)
    if (scope === 'mine') query = query.eq('assigned_user_id', userId)
    if (scope === 'open') query = query.eq('status', 'open')

    if (q) {
      const digits = normalizePartnerPhone(q)
      const clauses = [`name.ilike.${q}%`, `name.ilike.% ${q}%`, `company.ilike.${q}%`, `company.ilike.% ${q}%`]
      if (digits && digits.length >= 3 && /^[\d\s()+.-]+$/.test(q)) {
        clauses.push(`phone_digits.like.${digits}%`)
      }
      query = query.or(clauses.join(','))
    }

    const { data, error } = await query
    if (error) throw error
    const rows = (data ?? []) as unknown as ReferralPartnerRow[]

    let fuzzy: ReferralPartnerRow[] = []
    if (q.length >= 3 && rows.length < 5 && scope !== 'mine') {
      const { data: similar } = await supabase.rpc('find_similar_referral_partners', {
        p_org: orgId,
        p_name: q,
        p_company: q,
      })
      const seen = new Set(rows.map((r) => r.id))
      const extraIds = ((similar ?? []) as Array<{ id: string }>).map((s) => s.id).filter((id) => !seen.has(id))
      if (extraIds.length) {
        const { data: extra } = await supabase
          .from('referral_partners')
          .select(PARTNER_SELECT)
          .eq('org_id', orgId)
          .in('id', extraIds)
        fuzzy = (extra ?? []) as unknown as ReferralPartnerRow[]
      }
    }

    const now = new Date()
    const present = (r: ReferralPartnerRow, similar: boolean) => ({
      ...redactPartner(r, userId, access),
      days_until_open: daysUntilOpen(r, now),
      is_mine: r.assigned_user_id === userId,
      similar,
    })
    return NextResponse.json({
      partners: [...rows.map((r) => present(r, false)), ...fuzzy.map((r) => present(r, true))],
    })
  } catch (error) {
    return partnerApiError(error, 'referral-partners list')
  }
}

/** Add Partner: Type, Name, Phone. Saving assigns the partner to the creator. */
export async function POST(request: NextRequest) {
  try {
    const { supabase, userId, orgId, access } = await partnerRequestContext()
    const body = await request.json()

    const name = String(body.name ?? '').trim()
    const phone = String(body.phone ?? '').trim()
    const typeId = String(body.type_id ?? '')
    const digits = normalizePartnerPhone(phone)
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    if (!digits || digits.length < 7) {
      return NextResponse.json({ error: 'Enter a phone number' }, { status: 400 })
    }

    const { data: type } = await supabase
      .from('referral_partner_types')
      .select('id, name, is_active')
      .eq('id', typeId)
      .eq('org_id', orgId)
      .maybeSingle()
    if (!type || !type.is_active) {
      return NextResponse.json({ error: 'Pick a type' }, { status: 400 })
    }

    const { data: existing } = await supabase
      .from('referral_partners')
      .select(PARTNER_SELECT)
      .eq('org_id', orgId)
      .eq('phone_digits', digits)
      .maybeSingle()
    if (existing) {
      return NextResponse.json(
        { error: 'exists', partner: redactPartner(existing as unknown as ReferralPartnerRow, userId, access) },
        { status: 409 }
      )
    }

    const clean = (v: unknown) => {
      const s = String(v ?? '').trim()
      return s || null
    }
    const { data, error } = await supabase
      .from('referral_partners')
      .insert({
        org_id: orgId,
        type_id: type.id,
        other_type_text: type.name.toLowerCase() === 'other' ? clean(body.other_type_text) : null,
        name,
        phone,
        email: clean(body.email),
        company: clean(body.company),
        notes: clean(body.notes),
        status: 'assigned',
        assigned_user_id: userId,
        created_by: userId,
      })
      .select(PARTNER_SELECT)
      .single()
    if (error?.code === '23505') {
      // Lost a race with another rep adding the same phone.
      const { data: winner } = await supabase
        .from('referral_partners')
        .select(PARTNER_SELECT)
        .eq('org_id', orgId)
        .eq('phone_digits', digits)
        .maybeSingle()
      return NextResponse.json(
        { error: 'exists', partner: winner ? redactPartner(winner as unknown as ReferralPartnerRow, userId, access) : null },
        { status: 409 }
      )
    }
    if (error) throw error
    return NextResponse.json({ partner: data })
  } catch (error) {
    return partnerApiError(error, 'referral-partners create')
  }
}
