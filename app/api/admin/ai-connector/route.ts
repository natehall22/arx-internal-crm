import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { listAudit, writeAudit } from '@/lib/ai-connector/audit'
import { loadExtraRedirectUris, parseExtraRedirectUris } from '@/lib/ai-connector/clients'
import { AI_CONNECTOR_FEATURE, BUILTIN_REDIRECT_URIS } from '@/lib/ai-connector/config'
import { listGrants, revokeAllForUser, revokeGrant } from '@/lib/ai-connector/store'
import { crossSiteWrite } from '@/lib/online-payments/access'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { mergeOrgSettings } from '@/lib/org-settings'
import { createServiceClient } from '@/lib/supabase/service'
import { isSuperAdmin } from '@/lib/super-admin'
import { orgDb } from '@/lib/supabase/org-db'

export const dynamic = 'force-dynamic'

type Owner = { userId: string; orgId: string }

async function owner(): Promise<Owner | NextResponse> {
  try {
    const { profile } = await requireAuthApi()
    if (!isSuperAdmin(profile)) return NextResponse.json({ error: 'Only an owner can manage the AI connector' }, { status: 403 })
    return { userId: profile.id, orgId: profile.org_id }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

/** GET — owners: is it on, who is connected, the app addresses allowed, and the audit log. (The on/off switch itself is Settings → Features.) */
export async function GET() {
  const o = await owner()
  if (o instanceof NextResponse) return o
  const admin = createServiceClient()
  const [enabled, grants, audit, extra] = await Promise.all([
    isOrgFeatureOn(o.orgId, AI_CONNECTOR_FEATURE),
    listGrants(admin, o.orgId),
    listAudit(admin, o.orgId, { limit: 100 }),
    loadExtraRedirectUris(admin, o.orgId),
  ])
  const ids = Array.from(new Set([...grants.map((g) => g.user_id), ...audit.map((a) => a.user_id).filter((x): x is string => !!x)]))
  const names = new Map<string, string>()
  if (ids.length) {
    const { data } = await orgDb(admin, o.orgId).from('users').select('id, full_name').in('id', ids)
    for (const u of (data ?? []) as Array<{ id: string; full_name: string | null }>) names.set(u.id, u.full_name ?? 'Unknown')
  }
  return NextResponse.json({
    enabled,
    readOnly: true,
    builtinRedirectUris: BUILTIN_REDIRECT_URIS,
    extraRedirectUris: extra,
    connections: grants.map((g) => ({ id: g.id, userId: g.user_id, person: names.get(g.user_id) ?? 'Unknown', app: g.app_label ?? g.client_name ?? 'An app', scopes: g.scopes, connectedAt: g.created_at, lastUsedAt: g.last_used_at })),
    audit: audit.map((a) => ({ id: a.id, when: a.created_at, person: a.user_id ? names.get(a.user_id) ?? 'Unknown' : null, tool: a.tool, result: a.result, records: a.record_ids.length, detail: a.detail })),
  })
}

/** PATCH { redirectUris } — extra app addresses this company allows (owners). */
export async function PATCH(request: Request) {
  if (crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const o = await owner()
  if (o instanceof NextResponse) return o
  const body = (await request.json().catch(() => null)) as { redirectUris?: unknown } | null
  const parsed = parseExtraRedirectUris(body?.redirectUris)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const admin = createServiceClient()
  const { error } = await mergeOrgSettings(admin, o.orgId, { redirectUris: parsed.uris }, { path: ['aiConnector'] })
  if (error) return NextResponse.json({ error }, { status: 400 })
  await writeAudit(admin, { orgId: o.orgId, userId: o.userId, clientId: null, tool: 'settings.redirect_uris', result: 'ok', detail: `${parsed.uris.length} address(es)` }).catch(() => undefined)
  return NextResponse.json({ success: true, extraRedirectUris: parsed.uris })
}

/** POST { grantId } or { userId } — disconnect one connection, or everything a person has connected (owners). */
export async function POST(request: Request) {
  if (crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const o = await owner()
  if (o instanceof NextResponse) return o
  const body = (await request.json().catch(() => null)) as { grantId?: unknown; userId?: unknown } | null
  const admin = createServiceClient()
  let count = 0
  if (typeof body?.grantId === 'string') count = (await revokeGrant(admin, o.orgId, body.grantId, 'owner_revoked')) ? 1 : 0
  else if (typeof body?.userId === 'string') count = await revokeAllForUser(admin, o.orgId, body.userId, 'owner_revoked')
  else return NextResponse.json({ error: 'Choose a connection or a person' }, { status: 400 })
  if (count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await writeAudit(admin, { orgId: o.orgId, userId: o.userId, clientId: null, tool: 'oauth.revoke', result: 'ok', detail: 'by an owner', recordIds: typeof body.grantId === 'string' ? [body.grantId] : [] }).catch(() => undefined)
  return NextResponse.json({ success: true, revoked: count })
}
