import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { effectiveCategory } from '@/lib/categories'
import { CATEGORIES_NOT_READY, loadCustomerCategories, setJobCategory } from '@/lib/categories-db'
import { resolveOpsAccess } from '@/lib/ops-access'
import { isMissingColumn } from '@/lib/supabase/errors'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** GET — a job's category: its own override, its customer's, and the one that counts. Anyone who can see the job board. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  let ctx
  try {
    ctx = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { authUser, profile } = ctx
  const admin = createServiceClient()
  const access = await resolveOpsAccess(admin, authUser.id, profile)
  if (!access.canJobBoard) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: job, error } = await admin.from('production_jobs').select('id, customer_id, category').eq('id', params.id).eq('org_id', profile.org_id).maybeSingle()
  if (error) {
    // Migration not applied: show "not set" and no editing, rather than an error on the job page.
    if (isMissingColumn(error, 'category')) return NextResponse.json({ ready: false, jobCategory: null, customerCategory: null, effective: null, canEdit: false })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  const customerCategory = job.customer_id ? (await loadCustomerCategories(admin, profile.org_id, [job.customer_id as string])).get(job.customer_id as string) ?? null : null
  const jobCategory = (job.category as string | null) || null
  return NextResponse.json({ ready: true, jobCategory, customerCategory, effective: effectiveCategory(jobCategory, customerCategory).slug, canEdit: access.canEditJobs })
}

/** PATCH { category: slug | null } — set or clear the job's override. Same access as editing the job. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  let ctx
  try {
    ctx = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { authUser, profile } = ctx
  const admin = createServiceClient()
  const access = await resolveOpsAccess(admin, authUser.id, profile)
  if (!access.canEditJobs) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = (await request.json().catch(() => null)) as { category?: unknown } | null
  if (!body || !('category' in body)) return NextResponse.json({ error: 'category is required (use null to clear)' }, { status: 400 })
  const r = await setJobCategory(admin, profile.org_id, params.id, body.category)
  if (!r.ok) return NextResponse.json({ error: r.status === 503 ? CATEGORIES_NOT_READY : r.error }, { status: r.status })
  return NextResponse.json({ jobCategory: r.category })
}
