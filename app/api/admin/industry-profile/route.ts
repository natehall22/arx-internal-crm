import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { INDUSTRY_PROFILE_IDS, INDUSTRY_PROFILES, isIndustryProfileId } from '@/lib/industry-profiles'
import { resolveOrgProfile } from '@/lib/org-profile'
import { applyIndustryProfile, loadProfileSwitchInputs, planProfileSwitch } from '@/lib/org-profile-server'
import { isSuperAdmin } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** Owners only (isSuperAdmin), like feature switches and trades. */
async function owner() {
  try {
    const { profile } = await requireAuthApi()
    return isSuperAdmin(profile) ? (profile as { id: string; org_id: string }) : null
  } catch {
    return null
  }
}

/**
 * GET ?to=<profile id>&resetFeatures=1 — the company's profile, the choices, and (with `to`) exactly what switching would
 * change. Reads only.
 */
export async function GET(request: Request) {
  const profile = await owner()
  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const url = new URL(request.url)
  const to = url.searchParams.get('to')
  if (to !== null && !isIndustryProfileId(to)) return NextResponse.json({ error: 'Unknown profile' }, { status: 400 })
  try {
    const { settings, trades } = await loadProfileSwitchInputs(createServiceClient(), profile.org_id)
    const current = resolveOrgProfile(settings)
    return NextResponse.json({
      current: { id: current.id, label: current.label, version: current.version, storedVersion: current.storedVersion, unknownStoredId: current.unknownStoredId },
      profiles: INDUSTRY_PROFILE_IDS.map((id) => ({ id, label: INDUSTRY_PROFILES[id].label, description: INDUSTRY_PROFILES[id].description, version: INDUSTRY_PROFILES[id].version })),
      plan: to ? planProfileSwitch(settings, trades, to, { resetFeatures: url.searchParams.get('resetFeatures') === '1' }) : null,
    })
  } catch (e) {
    console.error('GET /api/admin/industry-profile', e)
    return NextResponse.json({ error: 'Could not load the industry profile' }, { status: 500 })
  }
}

/** POST { profile, resetFeatures? } — apply. Never deletes data (lib/org-profile-server.ts). */
export async function POST(request: Request) {
  const profile = await owner()
  if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as { profile?: unknown; resetFeatures?: unknown } | null
  if (!body || !isIndustryProfileId(body.profile)) return NextResponse.json({ error: 'Choose a profile' }, { status: 400 })
  if (body.resetFeatures !== undefined && typeof body.resetFeatures !== 'boolean') return NextResponse.json({ error: 'resetFeatures must be true or false' }, { status: 400 })
  try {
    const { plan } = await applyIndustryProfile(createServiceClient(), profile.org_id, profile.id, body.profile, { resetFeatures: body.resetFeatures === true })
    return NextResponse.json({ success: true, plan })
  } catch (e) {
    console.error('POST /api/admin/industry-profile', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not apply the profile' }, { status: 500 })
  }
}
