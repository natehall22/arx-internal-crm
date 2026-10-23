/**
 * DELETE { reason } — owner only (a super admin): bring a job that was settled outside the CRM back into CRM payroll.
 * It would then be paid in full by the next payroll run, so a reason is required and an audit row is written.
 */
import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { unsettleJob } from '@/lib/job-settlement'
import { isSuperAdmin } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isSuperAdmin(profile as { is_super_admin?: boolean | null; active?: boolean | null })) {
    return NextResponse.json({ error: 'Only an owner can do this.' }, { status: 403 })
  }
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  const body = (await request.json().catch(() => ({}))) as { reason?: unknown }
  const res = await unsettleJob(createServiceClient(), { orgId: profile.org_id, actorUserId: profile.id, jobId: params.id, reason: typeof body.reason === 'string' ? body.reason : '' })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true })
}
