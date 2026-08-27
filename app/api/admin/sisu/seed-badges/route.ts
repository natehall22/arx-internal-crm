import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { DEFAULT_BADGES } from '@/lib/sisu-default-badges'
import { isSisuAdminRole } from '@/lib/sisu-admin-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function POST() {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isSisuAdminRole(profile.role) || !profile.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const admin = createServiceClient()

  const { count, error: countError } = await admin
    .from('incentive_badges')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', profile.org_id)

  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 })

  if ((count ?? 0) > 0) {
    return NextResponse.json({ seeded: false, reason: 'Badges already exist' })
  }

  const rows = DEFAULT_BADGES.map((badge) => ({
    ...badge,
    org_id: profile.org_id,
  }))

  const { error: insertError } = await admin.from('incentive_badges').insert(rows)

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  return NextResponse.json({ seeded: true, count: rows.length })
}
