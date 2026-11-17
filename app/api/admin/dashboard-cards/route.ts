import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import {
  AUDIENCE_LABELS,
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
import { isOwnerProfile, isSuperAdmin } from '@/lib/super-admin'

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
// Who may open Dashboard settings at all: the same people as /api/admin/dashboard-settings (admin, regional and sales managers) plus owners.
const canSeeSettings = (p: Auth['profile']) => canEditCards(p) || ['regional_manager', 'sales_manager'].includes(p.role)

/** Where the company's dashboard stands and who is asking: the facts `saveDashboardCards` enforces its rules against. */
async function saveContext(admin: ReturnType<typeof createServiceClient>, p: Auth['profile']) {
  const [{ data: org }, orgProfile] = await Promise.all([
    admin.from('orgs').select('settings').eq('id', p.org_id).single(),
    loadOrgProfile(admin, p.org_id),
  ])
  const resolved = resolveDashboard((org as { settings?: unknown } | null)?.settings, orgProfile.dashboard.cards)
  return { orgProfile, resolved, ctx: { owner: isSuperAdmin(p), profileId: orgProfile.id, currentMode: resolved.mode, startMode: (orgProfile.dashboard.cards === null ? 'classic' : 'cards') as DashboardMode } }
}

/** GET — the company's dashboard cards: what it has now, and what it may add. Dashboard-settings people read; admins / owners save cards, the owner alone the classic sections and the switch. */
export async function GET(request: Request) {
  const auth = await authed()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { profile } = auth
  if (!canSeeSettings(profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createServiceClient()
  const { orgProfile, resolved, ctx } = await saveContext(admin, profile)
  // "?mode=cards" asks for the card catalog while the company is still on the classic dashboard (to start a card dashboard).
  const canBuildCards = ctx.owner && resolved.mode === 'classic' && ctx.profileId !== 'roofing'
  const asked: DashboardMode = new URL(request.url).searchParams.get('mode') === 'cards' ? 'cards' : resolved.mode
  const wanted: DashboardMode = asked === 'cards' && resolved.mode === 'classic' && !canBuildCards ? resolved.mode : asked
  const brief = (c: (typeof DASHBOARD_CARDS)[number]) => ({ key: c.key, label: c.label, description: c.description, group: c.group, goal: !!c.goal, audiences: c.audience.map((a) => AUDIENCE_LABELS[a]), goalUnit: c.display === 'money' ? 'money' : c.display === 'percent' ? 'percent' : 'count' })
  return NextResponse.json({
    mode: resolved.mode,
    editingMode: wanted,
    custom: resolved.custom,
    cards: wanted === resolved.mode ? resolved.cards : [],
    offered: cardsOfferedTo(orgProfile.features, wanted).map(brief),
    // Wanted but with no existing data source: shown greyed in the editor so the owner can see why they are not on the list.
    unavailable: DASHBOARD_CARDS.filter((c) => !isDrawableCard(c)).map((c) => ({ key: c.key, label: c.label, reason: (c.source as { reason: string }).reason })),
    // Offered only to the owner, and never to a roofing company (it keeps the classic dashboard).
    canBuildCards,
    // A card dashboard: owners and admins edit it. The classic one (which sections show): the owner only.
    canEdit: wanted === 'cards' && resolved.mode === 'cards' ? canEditCards(profile) : ctx.owner,
  })
}

/** PUT { cards: [{ key, goal? }] } — save the list (admins / owners). Only catalog keys whose features are on are accepted. */
export async function PUT(request: Request) {
  const auth = await authed()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditCards(auth.profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createServiceClient()
  const { orgProfile, ctx } = await saveContext(admin, auth.profile)
  const saved = await saveDashboardCards(admin, auth.profile.org_id, await request.json().catch(() => null), orgProfile.features, ctx)
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status })
  return NextResponse.json({ ok: true, cards: saved.cards })
}

/** DELETE — back to the industry profile's starting list. */
export async function DELETE() {
  const auth = await authed()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canEditCards(auth.profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createServiceClient()
  const { orgProfile, ctx } = await saveContext(admin, auth.profile)
  const saved = await saveDashboardCards(admin, auth.profile.org_id, null, orgProfile.features, ctx, { reset: true })
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status })
  return NextResponse.json({ ok: true })
}
