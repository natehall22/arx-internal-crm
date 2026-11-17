import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import {
  DASHBOARD_CARDS,
  cardsOfferedTo,
  isDrawableCard,
  resolveDashboard,
  type DashboardMode,
} from '@/lib/dashboard-cards'
import { saveDashboardCards } from '@/lib/dashboard-cards-server'
import { isOrgSuperuserRoleSlug } from '@/lib/org-role-constants'
import { loadOrgProfile } from '@/lib/org-profile'
import { createServiceClient } from '@/lib/supabase/service'
import { isOwnerProfile } from '@/lib/super-admin'

export const dynamic = 'force-dynamic'

type Auth = { profile: { id: string; org_id: string; role: string; is_super_admin?: boolean | null; active?: boolean | null } }

async function authed(): Promise<Auth | null> {
  try {
    return (await requireAuthApi()) as unknown as Auth
  } catch {
    return null
  }
}

const canEditCards = (p: Auth['profile']) => isOrgSuperuserRoleSlug(p.role) || isOwnerProfile(p)

/** GET — the company's dashboard cards: what it has now, the starting list, and what it may add. Leadership reads; admins / owners save. */
export async function GET(request: Request) {
  const auth = await authed()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { profile } = auth
  const admin = createServiceClient()
  const [{ data: org }, orgProfile] = await Promise.all([
    admin.from('orgs').select('settings').eq('id', profile.org_id).single(),
    loadOrgProfile(admin, profile.org_id),
  ])
  const resolved = resolveDashboard((org as { settings?: unknown } | null)?.settings, orgProfile.dashboard.cards)
  // "?mode=cards" asks for the card catalog while the company is still on the classic dashboard (to start a card dashboard).
  const wanted: DashboardMode = new URL(request.url).searchParams.get('mode') === 'cards' ? 'cards' : resolved.mode
  const brief = (c: (typeof DASHBOARD_CARDS)[number]) => ({ key: c.key, label: c.label, description: c.description, group: c.group, goal: !!c.goal, goalUnit: c.display === 'money' ? 'money' : c.display === 'percent' ? 'percent' : 'count' })
  return NextResponse.json({
    mode: resolved.mode,
    editingMode: wanted,
    custom: resolved.custom,
    cards: wanted === resolved.mode ? resolved.cards : [],
    offered: cardsOfferedTo(orgProfile.features, wanted).map(brief),
    // Wanted but with no existing data source: shown greyed in the editor so the owner can see why they are not on the list.
    unavailable: DASHBOARD_CARDS.filter((c) => !isDrawableCard(c)).map((c) => ({ key: c.key, label: c.label, reason: (c.source as { reason: string }).reason })),
    startsClassic: orgProfile.dashboard.cards === null,
    canEdit: canEditCards(profile),
  })
}

/** PUT { cards: [{ key, goal? }] } — save the list (admins / owners). Only catalog keys whose features are on are accepted. */
export async function PUT(request: Request) {
  const auth = await authed()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditCards(auth.profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createServiceClient()
  const orgProfile = await loadOrgProfile(admin, auth.profile.org_id)
  const saved = await saveDashboardCards(admin, auth.profile.org_id, await request.json().catch(() => null), orgProfile.features)
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status })
  return NextResponse.json({ ok: true, cards: saved.cards })
}

/** DELETE — back to the industry profile's starting list. */
export async function DELETE() {
  const auth = await authed()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditCards(auth.profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createServiceClient()
  const orgProfile = await loadOrgProfile(admin, auth.profile.org_id)
  const saved = await saveDashboardCards(admin, auth.profile.org_id, null, orgProfile.features, { reset: true })
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status })
  return NextResponse.json({ ok: true })
}
