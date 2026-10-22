/** POST — this user closes this announcement; saved per user so it stays closed on every device. */
import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const admin = createServiceClient()
  const { data: ann } = await admin.from('announcements').select('id').eq('id', params.id).eq('org_id', profile.org_id).maybeSingle()
  if (!ann) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { error } = await admin
    .from('announcement_dismissals')
    .upsert({ org_id: profile.org_id, announcement_id: params.id, user_id: profile.id }, { onConflict: 'announcement_id,user_id', ignoreDuplicates: true })
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
