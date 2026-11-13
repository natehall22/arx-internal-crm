import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { CATEGORIES_NOT_READY, setLeadCategory } from '@/lib/categories-db'
import { mayReadLead } from '@/lib/contact-scope'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * PATCH { category: slug | null } — set or clear a lead's work category (the lead page's one-tap picker). Same access as the
 * lead page's own edits: reps only their own leads, and anyone whose contact scope hides the lead gets "not found".
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  let ctx
  try {
    ctx = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { profile } = ctx
  const admin = createServiceClient()
  let own = admin.from('leads').select('id').eq('id', params.id).eq('org_id', profile.org_id)
  if (profile.role === 'rep') own = own.eq('owner_user_id', profile.id)
  const { data: found } = await own.maybeSingle()
  if (!found || !(await mayReadLead(admin, profile, params.id))) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as { category?: unknown } | null
  if (!body || !('category' in body)) return NextResponse.json({ error: 'category is required (use null to clear)' }, { status: 400 })
  const r = await setLeadCategory(admin, profile.org_id, params.id, body.category)
  if (!r.ok) return NextResponse.json({ error: r.status === 503 ? CATEGORIES_NOT_READY : r.error }, { status: r.status })
  return NextResponse.json({ category: r.category })
}
