/**
 * PUBLIC — the vendor's one-tap "I have this order" (link in the PO email). The token is the credential: only its hash is stored,
 * the company comes from the order it belongs to, and it changes nothing but the confirmation. Expires after 90 days; each send
 * (and a revision) issues a new one.
 */
import { NextRequest, NextResponse } from 'next/server'

import { fenceAllowsOrg } from '@/lib/company-host'
import { getRequestHostFence } from '@/lib/company-host-server'
import { acknowledgeByToken } from '@/lib/purchase-orders-db'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const hits = new Map<string, { n: number; at: number }>()
function limited(ip: string): boolean {
  const now = Date.now()
  const h = hits.get(ip)
  if (!h || now - h.at > 15 * 60_000) {
    hits.set(ip, { n: 1, at: now })
    if (hits.size > 2000) hits.clear()
    return false
  }
  h.n += 1
  return h.n > 30
}

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const ip = (request.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
  if (limited(ip)) return NextResponse.json({ error: 'Too many tries. Please wait a few minutes.' }, { status: 429 })
  const body = (await request.json().catch(() => null)) as { note?: unknown } | null
  const note = typeof body?.note === 'string' ? body.note : null
  const fence = await getRequestHostFence()
  const r = await acknowledgeByToken(createServiceClient(), params.token, note, (orgId) => fenceAllowsOrg(fence, orgId))
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.message ?? 'This link is not valid.' }, { status: 404 })
}
