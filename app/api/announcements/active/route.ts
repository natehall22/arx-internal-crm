/** GET — the one announcement banner this user should see right now (or null). Per-user dismissal lives in the database. */
import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { pickAnnouncement, type AnnouncementRow } from '@/lib/announcements'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function GET() {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createServiceClient()
  const nowIso = new Date().toISOString()
  const [rowsRes, dismissedRes] = await Promise.all([
    admin
      .from('announcements')
      .select('id, title, body, link_url, starts_at, ends_at, active')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .lte('starts_at', nowIso)
      .gt('ends_at', nowIso)
      .order('starts_at', { ascending: false })
      .limit(10),
    admin.from('announcement_dismissals').select('announcement_id').eq('user_id', profile.id),
  ])
  // The banner must never break a page: any problem just means "no banner".
  if (rowsRes.error || dismissedRes.error) return NextResponse.json({ announcement: null })
  const picked = pickAnnouncement(
    (rowsRes.data ?? []) as AnnouncementRow[],
    new Set((dismissedRes.data ?? []).map((d) => d.announcement_id as string)),
    profile.role,
    new Date()
  )
  if (!picked) return NextResponse.json({ announcement: null })
  return NextResponse.json({
    announcement: { id: picked.announcement.id, title: picked.announcement.title, lines: picked.lines, link: picked.announcement.link_url },
  })
}
