/** GET — the one announcement banner this user should see right now (or null). Per-user dismissal lives in the database. */
import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { isSafeInternalLink, pickAnnouncement, type AnnouncementRow } from '@/lib/announcements'
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
  const rowsRes = await admin
      .from('announcements')
      .select('id, title, body, link_url, starts_at, ends_at, active')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .lte('starts_at', nowIso)
      .gt('ends_at', nowIso)
      .order('starts_at', { ascending: false })
      .limit(10)
  // The banner must never break a page: any problem just means "no banner".
  if (rowsRes.error) return NextResponse.json({ announcement: null })
  // Re-check the link at read time too: a row written straight in SQL skips the editor's validation.
  const rows = ((rowsRes.data ?? []) as AnnouncementRow[]).filter((r) => isSafeInternalLink(r.link_url))
  if (rows.length === 0) return NextResponse.json({ announcement: null })
  const dismissedRes = await admin
    .from('announcement_dismissals')
    .select('announcement_id')
    .eq('user_id', profile.id)
    .in('announcement_id', rows.map((r) => r.id))
  if (dismissedRes.error) return NextResponse.json({ announcement: null })
  const picked = pickAnnouncement(
    rows,
    new Set((dismissedRes.data ?? []).map((d) => d.announcement_id as string)),
    profile.role,
    new Date()
  )
  if (!picked) return NextResponse.json({ announcement: null })
  return NextResponse.json({
    announcement: { id: picked.announcement.id, title: picked.announcement.title, lines: picked.lines, link: picked.announcement.link_url },
  })
}
