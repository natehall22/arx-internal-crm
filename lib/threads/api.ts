import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { loadDeal } from '@/lib/threads/get-thread'
import { resolveThreadViewer } from '@/lib/threads/viewer'
import { isRecognizedViewer, ownsDeal, type DealRef, type ThreadViewer } from '@/lib/threads/visibility'

type Profile = Awaited<ReturnType<typeof requireAuthApi>>['profile']

export type ThreadCtx = {
  admin: ReturnType<typeof createServiceClient>
  profile: Profile
  viewer: ThreadViewer
}

export async function threadAuth(): Promise<ThreadCtx | NextResponse> {
  let profile: Profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createServiceClient()
  return { admin, profile, viewer: await resolveThreadViewer(admin, profile) }
}

/** Who may open a deal at all: owners/ops/managers any; the rest only deals they set or own (inside sales work the whole queue). */
export function canOpenDeal(v: ThreadViewer, deal: NonNullable<DealRef>): boolean {
  if (v.ownerLike || v.jobBoard || v.managerLike) return true
  if (!isRecognizedViewer(v)) return false // sub, custom-only roles: nothing
  if (!v.setterLike && !v.closerLike) return true // inside sales: queue-wide
  return ownsDeal(v, deal)
}

export async function threadDeal(ctx: ThreadCtx, dealId: string) {
  const deal = await loadDeal(ctx.admin, ctx.viewer.orgId, dealId)
  if (!deal || !canOpenDeal(ctx.viewer, deal)) return null
  return deal
}
