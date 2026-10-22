/**
 * Owner-only announcement editor.
 *   GET  — every announcement with who has / hasn't dismissed it (active users who can see it)
 *   POST — create or update one (validated by lib/announcements.ts)
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { parseAnnouncementInput, roleGroupFor, linesFor, type AnnouncementBody } from '@/lib/announcements'
import { createServiceClient } from '@/lib/supabase/service'
import { isOwnerProfile } from '@/lib/super-admin'

export const dynamic = 'force-dynamic'

async function authorize() {
  try {
    const { profile } = await requireAuthApi()
    if (!isOwnerProfile(profile)) return { error: NextResponse.json({ error: 'Only owners can manage announcements' }, { status: 403 }) }
    return { profile, admin: createServiceClient() }
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
}

export async function GET() {
  const a = await authorize()
  if ('error' in a) return a.error
  const orgId = a.profile.org_id
  const [annRes, usersRes, disRes] = await Promise.all([
    a.admin.from('announcements').select('id, slug, title, body, link_url, starts_at, ends_at, active').eq('org_id', orgId).order('starts_at', { ascending: false }).limit(50),
    a.admin.from('users').select('id, full_name, role, active').eq('org_id', orgId).eq('active', true),
    a.admin.from('announcement_dismissals').select('announcement_id, user_id, dismissed_at').eq('org_id', orgId),
  ])
  if (annRes.error) return NextResponse.json({ error: 'Could not load announcements' }, { status: 500 })
  const dismissed = new Map<string, Map<string, string>>()
  for (const d of disRes.data ?? []) {
    const m = dismissed.get(d.announcement_id as string) ?? new Map<string, string>()
    m.set(d.user_id as string, d.dismissed_at as string)
    dismissed.set(d.announcement_id as string, m)
  }
  const announcements = (annRes.data ?? []).map((an) => {
    const done = dismissed.get(an.id as string) ?? new Map<string, string>()
    // Only people this announcement actually has copy for count as "should have seen it".
    const audience = (usersRes.data ?? []).filter((u) => linesFor(an.body as AnnouncementBody, roleGroupFor(u.role as string)).length > 0)
    return {
      ...an,
      dismissed: audience.filter((u) => done.has(u.id as string)).map((u) => ({ name: u.full_name, at: done.get(u.id as string) })),
      not_dismissed: audience.filter((u) => !done.has(u.id as string)).map((u) => ({ name: u.full_name })),
    }
  })
  return NextResponse.json({ announcements })
}

export async function POST(request: NextRequest) {
  const a = await authorize()
  if ('error' in a) return a.error
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const parsed = parseAnnouncementInput(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const id = typeof body?.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null
  const row = { ...parsed.value, updated_at: new Date().toISOString() }
  const result = id
    ? await a.admin.from('announcements').update(row).eq('id', id).eq('org_id', a.profile.org_id).select('id').maybeSingle()
    : await a.admin.from('announcements').insert({ ...row, org_id: a.profile.org_id, created_by: a.profile.id }).select('id').maybeSingle()
  if (result.error) {
    if (String(result.error.message).includes('announcements_org_id_slug_key')) return NextResponse.json({ error: 'An announcement with that slug already exists' }, { status: 409 })
    return NextResponse.json({ error: 'Could not save the announcement' }, { status: 500 })
  }
  if (!result.data) return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })
  return NextResponse.json({ id: result.data.id })
}
