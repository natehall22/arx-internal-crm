import { NextResponse } from 'next/server'

import { importOwner } from '@/lib/jobber-import/access'
import { assignHeld, listHeld } from '@/lib/signed-import/db'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET — signed documents brought over that are still waiting for a customer, with the best match found now. Owners only. */
export async function GET() {
  const owner = await importOwner()
  if (owner instanceof NextResponse) return owner
  return NextResponse.json(await listHeld(createServiceClient(), owner.org_id))
}

/** POST { assignments: [{ customerId, documentIds[] }] } — the owner picked a customer for waiting documents. */
export async function POST(request: Request) {
  const owner = await importOwner()
  if (owner instanceof NextResponse) return owner
  const body = (await request.json().catch(() => null)) as { assignments?: unknown } | null
  const r = await assignHeld(createServiceClient(), owner.org_id, body?.assignments)
  return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error }, { status: r.status })
}
