import { NextResponse } from 'next/server'

import { unsubscribeMessage } from '@/lib/customer-messages-db'
import { resolvePublicMessage } from '@/lib/customer-messages-public'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/m/[token]/unsubscribe — public. The "Stop these emails" button on /m/<token>, and the mail app's one-click
 * unsubscribe (RFC 8058 List-Unsubscribe-Post, body `List-Unsubscribe=One-Click`). Idempotent. GET does nothing (link
 * scanners open every link in an email; only a POST stops anything).
 */
/** GET (a mail app that opens the List-Unsubscribe address, or a link scanner): the page, never a change. */
export async function GET(request: Request, { params }: { params: { token: string } }) {
  return NextResponse.redirect(new URL(`/m/${encodeURIComponent(params.token)}?stop=1`, request.url), { status: 303 })
}

export async function POST(_request: Request, { params }: { params: { token: string } }) {
  const admin = createServiceClient()
  const row = await resolvePublicMessage(admin, params.token)
  if (!row) return NextResponse.json({ error: 'This link isn’t active' }, { status: 404 })
  try {
    await unsubscribeMessage(admin, row)
  } catch (e) {
    console.error('[unsubscribe] failed', { orgId: row.org_id, e })
    return NextResponse.json({ error: 'Something went wrong — please try again' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
