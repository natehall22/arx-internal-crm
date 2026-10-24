import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { isContactScoped } from '@/lib/contact-scope'
import { buildIlikeFilterValue } from '@/lib/referral-links'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** "Pat Smith" -> "Pat S." : enough to recognise the person, not enough to contact or look them up elsewhere. */
function maskName(name: string | null): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'Unnamed'
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`
}

/**
 * "Who referred this lead?" lookup for the new-lead form. Replaces the form's direct database reads, which a setter's own
 * access (own work only) can no longer see. Setters and canvassers get a masked name + address and NO phone / email; everyone
 * else gets the full record as before. The referral itself is created server-side (/api/referrals/for-new-lead), so the
 * contact details never need to reach the setter's phone.
 */
export async function GET(request: NextRequest) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const q = (request.nextUrl.searchParams.get('q') || '').trim()
  if (q.length < 2) return NextResponse.json({ results: [] })

  const admin = createServiceClient()
  const scoped = await isContactScoped(admin, profile)
  const pattern = buildIlikeFilterValue(q)

  const [{ data: customers }, { data: leads }] = await Promise.all([
    admin.from('customers').select('id, name, phone, email, address_text').eq('org_id', profile.org_id)
      .or(`name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern},address_text.ilike.${pattern}`).limit(10),
    admin.from('leads').select('id, homeowner_name, phone, email, address_text').eq('org_id', profile.org_id)
      .in('status', ['won', 'appointment', 'inspection', 'estimate_sent'])
      .or(`homeowner_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern},address_text.ilike.${pattern}`).limit(10),
  ])

  const rows = [
    ...(customers ?? []).map((c) => ({ id: c.id as string, type: 'customer' as const, name: (c.name as string | null) || 'Unnamed Customer', phone: c.phone as string | null, email: c.email as string | null, address: c.address_text as string | null })),
    ...(leads ?? []).map((l) => ({ id: l.id as string, type: 'lead' as const, name: (l.homeowner_name as string | null) || 'Unnamed Lead', phone: l.phone as string | null, email: l.email as string | null, address: l.address_text as string | null })),
  ]
  const seen = new Set<string>()
  const unique = rows.filter((r) => {
    const key = `${r.name}-${r.phone}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const results = scoped ? unique.map((r) => ({ id: r.id, type: r.type, name: maskName(r.name), phone: null, email: null, address: r.address, masked: true })) : unique.map((r) => ({ ...r, masked: false }))
  return NextResponse.json({ results })
}
