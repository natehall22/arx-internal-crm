import { NextResponse } from 'next/server'

import { importOwner } from '@/lib/jobber-import/access'
import { listSignedRuns, openSignedRun } from '@/lib/signed-import/db'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** GET — the company's signed-document imports, newest first (`ready: false` until migration 202611190010). Owners only. */
export async function GET() {
  const owner = await importOwner()
  if (owner instanceof NextResponse) return owner
  return NextResponse.json(await listSignedRuns(createServiceClient(), owner.org_id))
}

/** POST — the open import (draft / importing / undoing), or a new one. */
export async function POST() {
  const owner = await importOwner()
  if (owner instanceof NextResponse) return owner
  const r = await openSignedRun(createServiceClient(), owner.org_id, owner.id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ run: r.run })
}
