import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { canEditLeadIntake, dropInactiveFromRotations, LEAD_INTAKE_SETTINGS_KEY, parseLeadIntakePatch, patchSinglePersonIds, patchUserIds, readLeadIntakeSettings, readRouting, readServiceOptions } from '@/lib/lead-intake'
import { loadCompanyServiceChoices } from '@/lib/lead-intake-db'
import { crossSiteWrite } from '@/lib/online-payments/access'
import { mergeOrgSettings } from '@/lib/org-settings'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

async function gate(request: Request | null) {
  if (request && crossSiteWrite(request)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  }
  if (!canEditLeadIntake(profile as never)) return { error: NextResponse.json({ error: 'Only admins and owners can change lead routing' }, { status: 403 }) } as const
  return { admin: createServiceClient(), orgId: profile.org_id as string } as const
}

async function view(admin: ReturnType<typeof createServiceClient>, orgId: string) {
  const [org, users, sources] = await Promise.all([
    admin.from('orgs').select('settings').eq('id', orgId).maybeSingle(),
    admin.from('users').select('id, full_name, email, active').eq('org_id', orgId).order('full_name'),
    admin.from('lead_sources').select('*').eq('org_id', orgId).order('name'),
  ])
  const settings = (org.data as { settings?: Record<string, unknown> } | null)?.settings ?? {}
  const intake = readLeadIntakeSettings(settings)
  const rows = (sources.data ?? []) as Array<Record<string, unknown>>
  const named = new Set<string>(patchUserIds({
    set: { userIds: intake.routing.userIds, rules: intake.routing.rules },
    leadOwnerId: typeof settings.web_leads_owner_id === 'string' ? settings.web_leads_owner_id : null,
    sources: rows.map((r) => ({ id: r.id as string, routing: readRouting(r.routing), autoAssignUserId: (r.auto_assign_user_id as string | null) ?? null })),
  }))
  return {
    routing: intake.routing,
    reminder: { enabled: intake.reminderEnabled, hours: intake.reminderHours },
    leadOwnerId: typeof settings.web_leads_owner_id === 'string' ? settings.web_leads_owner_id : null,
    // Active people, plus any inactive person a saved setting still names (shown "(inactive)" so the admin can see why turns skip them).
    people: ((users.data ?? []) as Array<{ id: string; full_name: string | null; email: string | null; active: boolean | null }>)
      .filter((u) => u.active === true || named.has(u.id))
      .map((u) => ({ id: u.id, name: u.full_name || u.email || 'Unnamed', ...(u.active === true ? {} : { inactive: true }) })),
    sources: rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      routing: readRouting(r.routing),
      autoAssignUserId: (r.auto_assign_user_id as string | null) ?? null,
      services: readServiceOptions(r.service_options),
    })),
    services: await loadCompanyServiceChoices(admin, orgId),
  }
}

/** Settings → Lead routing: who new leads go to, and when an untouched lead counts as waiting. */
export async function GET() {
  const g = await gate(null)
  if ('error' in g) return g.error
  return NextResponse.json(await view(g.admin, g.orgId))
}

export async function PATCH(request: Request) {
  const g = await gate(request)
  if ('error' in g) return g.error
  const patch = parseLeadIntakePatch(await request.json().catch(() => null))
  if ('error' in patch) return NextResponse.json({ error: patch.error }, { status: 400 })

  // Every person must belong to THIS company. A rotation or service list quietly drops people who are no longer active (and
  // the answer says who); the single-person pickers must still be active.
  const ids = patchUserIds(patch)
  const names = new Map<string, string>()
  let cleaned = patch
  let removed: string[] = []
  if (ids.length) {
    const { data } = await g.admin.from('users').select('id, full_name, email, active').eq('org_id', g.orgId).in('id', ids)
    const found = (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null; active: boolean | null }>
    if (found.length !== ids.length) return NextResponse.json({ error: 'Pick people from your team' }, { status: 400 })
    const active = new Set(found.filter((u) => u.active === true).map((u) => u.id))
    for (const u of found) names.set(u.id, u.full_name || u.email || 'Unnamed')
    if (patchSinglePersonIds(patch).some((id) => !active.has(id))) return NextResponse.json({ error: 'Pick an active person' }, { status: 400 })
    ;({ patch: cleaned, removed } = dropInactiveFromRotations(patch, (id) => active.has(id)))
  }
  if (cleaned.sources.length) {
    const { data } = await g.admin.from('lead_sources').select('id').eq('org_id', g.orgId).in('id', cleaned.sources.map((s) => s.id))
    if (((data ?? []) as Array<{ id: string }>).length !== cleaned.sources.length) return NextResponse.json({ error: 'Lead source not found' }, { status: 404 })
  }

  if (Object.keys(cleaned.set).length) {
    const { error } = await mergeOrgSettings(g.admin, g.orgId, cleaned.set, { path: [LEAD_INTAKE_SETTINGS_KEY] })
    if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
  if (cleaned.leadOwnerId !== undefined) {
    const { error } = cleaned.leadOwnerId
      ? await mergeOrgSettings(g.admin, g.orgId, { web_leads_owner_id: cleaned.leadOwnerId })
      : await mergeOrgSettings(g.admin, g.orgId, {}, { remove: ['web_leads_owner_id'] })
    if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
  for (const s of cleaned.sources) {
    const { error } = await g.admin
      .from('lead_sources')
      .update({ routing: s.routing, ...(s.autoAssignUserId !== undefined ? { auto_assign_user_id: s.autoAssignUserId } : {}) })
      .eq('org_id', g.orgId)
      .eq('id', s.id)
    if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
  return NextResponse.json({ ...(await view(g.admin, g.orgId)), removed: removed.map((id) => names.get(id) ?? 'Someone') })
}
