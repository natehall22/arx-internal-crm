import { NextResponse } from 'next/server'

import { FILES_BUCKET } from '@/lib/files/storage'
import { servicePlanRouteAuth } from '@/lib/service-plans-access'
import { orgDb } from '@/lib/supabase/org-db'

export const runtime = 'nodejs'

/** GET — open one visit photo (a 10-minute signed link). */
export async function GET(_request: Request, { params }: { params: { id: string; photoId: string } }) {
  const ctx = await servicePlanRouteAuth('view')
  if (ctx instanceof Response) return ctx
  const { data: photo } = await orgDb(ctx.admin, ctx.orgId)
    .from('photos')
    .select('id, storage_path')
    .eq('id', params.photoId)
    .eq('work_order_id', params.id)
    .is('job_id', null)
    .is('deleted_at', null)
    .maybeSingle()
  const path = (photo as { storage_path?: string } | null)?.storage_path
  if (!path) return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
  const { data, error } = await ctx.admin.storage.from(FILES_BUCKET).createSignedUrl(path, 600)
  if (error || !data?.signedUrl) return NextResponse.json({ error: 'Could not open the photo' }, { status: 500 })
  return NextResponse.redirect(data.signedUrl)
}
