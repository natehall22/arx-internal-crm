/**
 * POST /api/canvass/solar/verify
 *
 * A rep standing at the curb answers the question an imagery detection asked:
 * does this house actually have solar?
 *
 * That answer is worth more than the detection it replaces. The detection is
 * Google-derived and expires after 30 days; a person's observation is ours and
 * doesn't. So a "yes" also strips the row of its borrowed provenance — source
 * becomes rep_verified, the imagery date is cleared, and the expiry is pushed out
 * of the way — leaving a record backed by a human, plus county parcel data that
 * never carried a restriction in the first place.
 *
 * A "no" is equally valuable and must be recorded, not discarded: it's how the
 * layer stops asking the same wrong question, and it's the only feedback we get
 * on the detector's real-world accuracy.
 */

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Far enough out that the row is effectively permanent, without a nullable column. */
const NO_EXPIRY = '2999-01-01T00:00:00.000Z'

export async function POST(request: NextRequest) {
  let auth
  try {
    auth = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { candidateId?: unknown; hasSolar?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const candidateId = typeof body.candidateId === 'string' ? body.candidateId.trim() : ''
  if (!candidateId) {
    return NextResponse.json({ error: 'candidateId is required' }, { status: 400 })
  }
  if (typeof body.hasSolar !== 'boolean') {
    return NextResponse.json({ error: 'hasSolar must be true or false' }, { status: 400 })
  }
  const hasSolar = body.hasSolar

  const admin = createServiceClient()

  const patch: Record<string, unknown> = {
    verified_has_solar: hasSolar,
    verified_at: new Date().toISOString(),
    verified_by: auth.authUser.id,
  }
  if (hasSolar) {
    // The claim is now a person's, not Google's — so drop the borrowed bits.
    patch.source = 'rep_verified'
    patch.imagery_date = null
    patch.expires_at = NO_EXPIRY
  }

  const { data, error } = await admin
    .from('solar_candidates')
    .update(patch)
    .eq('id', candidateId)
    .select('id, verified_has_solar')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  }
  if (!data) {
    // Already purged, or a stale id from a map the rep has had open a while.
    return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, candidateId: data.id, hasSolar })
}
