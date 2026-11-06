import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import {
  JOB_CATCH_UP_ENABLED_KEY,
  JOB_CATCH_UP_STUCK_DAYS_KEY,
  MAX_STUCK_DAYS,
  MIN_STUCK_DAYS,
  canEditJobCatchUpSettings,
  parseStuckDays,
} from '@/lib/job-catch-up-settings'
import { loadJobCatchUpSettings } from '@/lib/job-catch-up-db'
import { mergeOrgSettings } from '@/lib/org-settings'
import { canOpenSettingsHub } from '@/lib/settings-registry'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

async function viewer() {
  try {
    return (await requireAuthApi()).profile
  } catch {
    return null
  }
}

/** The org's catch-up switch and stuck-days. Anyone who can open Settings reads it; only admins change it. */
export async function GET() {
  const profile = await viewer()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canOpenSettingsHub(profile.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const settings = await loadJobCatchUpSettings(createServiceClient(), profile.org_id)
  return NextResponse.json({ ...settings, canEdit: canEditJobCatchUpSettings(profile) })
}

/** PUT { enabled?: boolean, stuckDays?: number } — admins only. Writes only these two keys (per-key merge). */
export async function PUT(request: NextRequest) {
  const profile = await viewer()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditJobCatchUpSettings(profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as { enabled?: unknown; stuckDays?: unknown } | null
  if (!body) return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })

  const set: Record<string, unknown> = {}
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'enabled must be true or false' }, { status: 400 })
    set[JOB_CATCH_UP_ENABLED_KEY] = body.enabled
  }
  if (body.stuckDays !== undefined) {
    const days = parseStuckDays(body.stuckDays)
    if (days == null) return NextResponse.json({ error: `Days must be a whole number from ${MIN_STUCK_DAYS} to ${MAX_STUCK_DAYS}` }, { status: 400 })
    set[JOB_CATCH_UP_STUCK_DAYS_KEY] = days
  }
  if (Object.keys(set).length === 0) return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })

  const admin = createServiceClient()
  const { error } = await mergeOrgSettings(admin, profile.org_id, set)
  if (error) return NextResponse.json({ error }, { status: 400 })
  const settings = await loadJobCatchUpSettings(admin, profile.org_id)
  return NextResponse.json({ ...settings, canEdit: true })
}
