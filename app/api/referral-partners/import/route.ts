import { NextRequest, NextResponse } from 'next/server'

import { partnerApiError, partnerRequestContext } from '@/lib/referral-partner-api'
import { normalizePartnerPhone } from '@/lib/referral-partners'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_ROWS = 500

type ImportRow = { name?: string; phone?: string; company?: string; email?: string; type?: string; notes?: string }

/** CSV bulk import (rows parsed client-side). Every row is assigned to the chosen rep. */
export async function POST(request: NextRequest) {
  try {
    const { supabase, userId, orgId, access } = await partnerRequestContext()
    if (!access.canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const rows: ImportRow[] = Array.isArray(body.rows)
      ? body.rows.filter((r: unknown): r is ImportRow => !!r && typeof r === 'object')
      : []
    if (rows.length === 0) return NextResponse.json({ error: 'No rows' }, { status: 400 })
    if (rows.length > MAX_ROWS) {
      return NextResponse.json({ error: `Import up to ${MAX_ROWS} rows at a time` }, { status: 400 })
    }

    const { data: assignee } = await supabase
      .from('users')
      .select('id')
      .eq('id', String(body.user_id ?? ''))
      .eq('org_id', orgId)
      .eq('active', true)
      .maybeSingle()
    if (!assignee) return NextResponse.json({ error: 'Pick an active rep' }, { status: 400 })

    const { data: types } = await supabase
      .from('referral_partner_types')
      .select('id, name, is_active')
      .eq('org_id', orgId)
    const typeByName = new Map((types ?? []).map((t) => [String(t.name).toLowerCase(), t]))
    const otherType = typeByName.get('other')

    const created: string[] = []
    const skipped: Array<{ row: number; name: string; reason: string }> = []

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i]
      const name = String(raw.name ?? '').trim()
      const digits = normalizePartnerPhone(raw.phone)
      if (!name) {
        skipped.push({ row: i + 1, name: '', reason: 'Missing name' })
        continue
      }
      if (!digits || digits.length < 7) {
        skipped.push({ row: i + 1, name, reason: 'Missing or invalid phone' })
        continue
      }
      const typeName = String(raw.type ?? '').trim().toLowerCase()
      const type = (typeName && typeByName.get(typeName)) || otherType
      if (!type || !type.is_active) {
        skipped.push({ row: i + 1, name, reason: 'No usable type' })
        continue
      }
      const { error } = await supabase.from('referral_partners').insert({
        org_id: orgId,
        type_id: type.id,
        other_type_text: !typeByName.get(typeName) && typeName ? String(raw.type).trim() : null,
        name,
        phone: String(raw.phone).trim(),
        email: String(raw.email ?? '').trim() || null,
        company: String(raw.company ?? '').trim() || null,
        notes: String(raw.notes ?? '').trim() || null,
        status: 'assigned',
        assigned_user_id: assignee.id,
        created_by: userId,
      })
      if (error?.code === '23505') {
        skipped.push({ row: i + 1, name, reason: 'Phone already exists' })
      } else if (error) {
        skipped.push({ row: i + 1, name, reason: 'Could not save' })
      } else {
        created.push(name)
      }
    }
    return NextResponse.json({ created: created.length, skipped })
  } catch (error) {
    return partnerApiError(error, 'referral-partners import')
  }
}
