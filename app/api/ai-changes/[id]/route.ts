import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { approveAiChange, declineAiChange, personContext } from '@/lib/ai-connector/changes-review'
import { ToolError } from '@/lib/ai-connector/tools/types'
import { crossSiteWrite } from '@/lib/online-payments/access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * POST { decision: 'approve' | 'decline' } — the signed-in PERSON's answer to a change an AI app prepared for them.
 * This is the ONLY door that saves an AI change. It needs this person's own session cookie AND a browser request from this
 * site (an AI app holds neither), and it re-checks the person's permission and the facts before writing.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!request.headers.get('origin') || crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as { decision?: unknown } | null
  if (body?.decision !== 'approve' && body?.decision !== 'decline') return NextResponse.json({ error: 'Choose Approve or Decline.' }, { status: 400 })
  const ctx = await personContext({ admin: createServiceClient(), profile, userId: profile.id, orgId: profile.org_id })
  try {
    const out = body.decision === 'approve' ? await approveAiChange(ctx, params.id) : await declineAiChange(ctx, params.id)
    return NextResponse.json({ ok: true, ...out.data })
  } catch (e) {
    if (e instanceof ToolError) {
      const status = e.code === 'not_found' ? 404 : e.code === 'denied' ? 403 : e.code === 'unavailable' ? 503 : 409
      return NextResponse.json({ error: e.message }, { status })
    }
    console.error('[ai-changes] approve failed', e)
    return NextResponse.json({ error: 'Something went wrong. Nothing was saved.' }, { status: 500 })
  }
}
