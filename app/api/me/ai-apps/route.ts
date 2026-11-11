import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { writeAudit } from '@/lib/ai-connector/audit'
import { listGrants, revokeGrant } from '@/lib/ai-connector/store'
import { crossSiteWrite } from '@/lib/online-payments/access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** GET — the AI apps the signed-in person has connected. */
export async function GET() {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const apps = await listGrants(createServiceClient(), profile.org_id, { userId: profile.id })
  return NextResponse.json({ apps: apps.map((a) => ({ id: a.id, app: a.app_label ?? a.client_name ?? 'An app', scopes: a.scopes, connected_at: a.created_at, last_used_at: a.last_used_at })) })
}

/** DELETE { id } — disconnect one of your own apps. */
export async function DELETE(request: Request) {
  if (crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null
  if (typeof body?.id !== 'string') return NextResponse.json({ error: 'Choose an app to disconnect' }, { status: 400 })
  const admin = createServiceClient()
  // Only YOUR grant: the person filter is part of the update.
  const done = await revokeGrant(admin, profile.org_id, body.id, 'user_revoked', Date.now(), profile.id)
  if (!done) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await writeAudit(admin, { orgId: profile.org_id, userId: profile.id, clientId: null, tool: 'oauth.revoke', recordIds: [body.id], result: 'ok', detail: 'by the person' }).catch(() => undefined)
  return NextResponse.json({ success: true })
}
