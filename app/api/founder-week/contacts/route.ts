import { NextRequest, NextResponse } from 'next/server'
import { requireFounderWeekUser } from '@/lib/founder-week-api'
import { parseFounderContact } from '@/lib/founder-contacts'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * /api/founder-week/contacts — realtors, recruits and other contacts typed into the founder
 * calendar. Each row belongs to the user who added it (created_by): GET returns only your own,
 * and the nightly email (/api/cron/founder-contacts-digest) goes to each user about their own.
 * Access: lib/founder-week-api.ts.
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET() {
  const access = await requireFounderWeekUser()
  if (!access.ok) return access.response

  const { data, error } = await createServiceClient()
    .from('founder_contacts')
    .select('id, kind, name, phone, email, company, notes, created_at')
    .eq('org_id', access.user.orgId)
    .eq('created_by', access.user.userId)
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) {
    console.error('[founder-week/contacts] list failed', error.message)
    return NextResponse.json({ error: 'Failed to load contacts' }, { status: 500, headers: NO_STORE })
  }
  return NextResponse.json({ contacts: data || [] }, { status: 200, headers: NO_STORE })
}

export async function POST(request: NextRequest) {
  const access = await requireFounderWeekUser()
  if (!access.ok) return access.response

  // JSON only: a cross-site <form> can't send application/json, so this closes the CSRF door
  // even if a session cookie were ever sent cross-site.
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Expected JSON' }, { status: 415, headers: NO_STORE })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE })
  }
  const parsed = parseFounderContact(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE })

  // client_id makes a retried submission (the page's offline outbox) a no-op instead of a duplicate.
  const rawClientId = (body as { clientId?: unknown }).clientId
  const clientId = typeof rawClientId === 'string' && rawClientId.trim() ? rawClientId.trim().slice(0, 64) : null
  const row = { ...parsed.value, org_id: access.user.orgId, created_by: access.user.userId, client_id: clientId }
  const table = createServiceClient().from('founder_contacts')
  const { error } = clientId
    ? await table.upsert(row, { onConflict: 'org_id,client_id', ignoreDuplicates: true })
    : await table.insert(row)
  if (error) {
    console.error('[founder-week/contacts] insert failed', error.message)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500, headers: NO_STORE })
  }
  return NextResponse.json({ ok: true }, { status: 201, headers: NO_STORE })
}
