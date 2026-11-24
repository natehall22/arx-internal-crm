import { NextResponse } from 'next/server'

import { proposalHiddenFrom } from '@/lib/category-scope'
import { requireAuthApi } from '@/lib/auth'
import { crossSiteWrite } from '@/lib/online-payments/access'
import { listProposalSnapshots, loadProposalSnapshot, MAX_SNAPSHOT_BYTES, resolveSnapshotAccess, saveProposalSnapshot, SNAPSHOT_REASONS, validateSnapshotInput, type SnapshotReason } from '@/lib/proposal-snapshots'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Caller = { error: NextResponse; admin?: undefined; auth?: undefined } | { error?: undefined; admin: ReturnType<typeof createServiceClient>; auth: Awaited<ReturnType<typeof requireAuthApi>> }

async function caller(request: Request, proposalId: string): Promise<Caller> {
  if (request.method !== 'GET' && crossSiteWrite(request)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  let auth: Awaited<ReturnType<typeof requireAuthApi>>
  try {
    auth = await requireAuthApi()
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!UUID.test(proposalId)) return { error: NextResponse.json({ error: 'Proposal not found' }, { status: 404 }) }
  const admin = createServiceClient()
  if (await proposalHiddenFrom(admin, auth.profile, proposalId)) return { error: NextResponse.json({ error: 'Proposal not found' }, { status: 404 }) }
  const access = await resolveSnapshotAccess(admin, auth.profile, auth.authUser.id, proposalId)
  if (!access.ok) return { error: NextResponse.json({ error: access.status === 403 ? 'Forbidden' : 'Proposal not found' }, { status: access.status }) }
  return { admin, auth }
}

/** History list; `?id=<snapshot>` returns that one snapshot (what the renderer needs to rebuild the PDF). */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const c = await caller(request, params.id)
  if (c.error) return c.error
  const one = new URL(request.url).searchParams.get('id')
  if (one) {
    if (!UUID.test(one)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const snapshot = await loadProposalSnapshot(c.admin, c.auth.profile.org_id, params.id, one)
    if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ snapshot })
  }
  return NextResponse.json({ snapshots: await listProposalSnapshots(c.admin, c.auth.profile.org_id, params.id) })
}

/** Record what was shown. An unchanged snapshot answers `stored: false` (nothing new); a failure never matters to the caller's download. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const c = await caller(request, params.id)
  if (c.error) return c.error
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_SNAPSHOT_BYTES + 4096) return NextResponse.json({ error: 'Snapshot is too large' }, { status: 413 })
  let body: { reason?: unknown; snapshot?: unknown }
  try {
    body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!SNAPSHOT_REASONS.includes(body.reason as SnapshotReason)) return NextResponse.json({ error: 'Unknown reason' }, { status: 400 })
  const v = validateSnapshotInput(body.snapshot, params.id)
  if ('error' in v) return NextResponse.json({ error: v.error }, { status: 400 })
  const r = await saveProposalSnapshot(c.admin, { orgId: c.auth.profile.org_id, userId: c.auth.authUser.id, proposalId: params.id, reason: body.reason as SnapshotReason, snapshot: v.snapshot })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ stored: r.stored })
}
