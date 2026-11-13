import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { requireAuthApi } from '@/lib/auth'
import {
  classifyFilesPath,
  fieldRoleMayReadFilesPath,
  filesPathFromStoredUrl,
  signFilesObject,
  type FilesPathClass,
} from '@/lib/files/files-object'
import { resolveIsFieldRole } from '@/lib/effective-permissions'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createServiceClient } from '@/lib/supabase/service'
import type { User } from '@/lib/types/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/files/object?path=<storage path or stored public URL>
 * Staff and subs: authorize the path, then 302 to a 10-minute signed URL for the `files` bucket.
 * Anything not allowed — or not there — is a 404, so the route never confirms that an object exists.
 * Rules: lib/files/files-object.ts (classifyFilesPath / fieldRoleMayReadFilesPath) + the DB checks below.
 */
const PRIVATE = { 'Cache-Control': 'private, no-store, max-age=0' }

function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE })
}

/** Field role by role slug or custom-role name (resolveIsFieldRole), or barred from sales docs (resolveSalesDocAccessBarred). */
async function isFieldOrSalesDocBarred(admin: SupabaseClient, profile: User): Promise<boolean> {
  if (await resolveIsFieldRole(admin, profile)) return true
  return resolveSalesDocAccessBarred(admin, profile.id, { role: profile.role, custom_role_id: profile.custom_role_id ?? null })
}

async function staffMayRead(admin: SupabaseClient, profile: User, path: string, c: FilesPathClass): Promise<boolean> {
  const orgId = profile.org_id
  if (!orgId) return false

  let inOrg = false
  if (c.kind === 'org' || c.kind === 'proposal_image' || c.kind === 'job_packet') {
    inOrg = c.orgId === orgId
  } else if (c.kind === 'legacy_change_order') {
    const { data } = await admin
      .from('job_change_orders')
      .select('id')
      .eq('org_id', orgId)
      .eq('pdf_storage_path', path)
      .limit(1)
    inOrg = (data?.length ?? 0) > 0
  } else if (c.kind === 'work_order_photo') {
    const { data } = await admin
      .from('work_order_photos')
      .select('id')
      .eq('org_id', orgId)
      .eq('storage_path', `files/${path}`)
      .limit(1)
    inOrg = (data?.length ?? 0) > 0
  } else {
    const { data } = await admin.from('files').select('id').eq('org_id', orgId).eq('storage_path', path).limit(1)
    inOrg = (data?.length ?? 0) > 0
  }
  if (!inOrg) return false

  if (fieldRoleMayReadFilesPath(c)) return true
  return !(await isFieldOrSalesDocBarred(admin, profile))
}

/** Subs read only what the sub job page shows them: shared/final files and the packet of a job assigned to their company. */
async function subMayRead(admin: SupabaseClient, profile: User, path: string, c: FilesPathClass): Promise<boolean> {
  const { data: subId } = await admin.rpc('get_sub_id_for_user', { user_uuid: profile.id })
  if (!subId) return false

  if (c.kind === 'job_packet') {
    // org-scope-ok: a sub reads only rows on jobs assigned to its own sub company (assigned_sub_id = subId)
    const { data } = await admin
      .from('production_jobs')
      .select('id')
      .eq('id', c.jobId)
      .eq('assigned_sub_id', subId)
      .eq('job_packet_pdf_path', path)
      .limit(1)
    if ((data?.length ?? 0) > 0) return true
  }

  // Same shape as GET /api/subs/jobs/[id]: files on the job or its project, shared with the sub or a final_* photo.
  // org-scope-ok: a sub reads only rows on jobs assigned to its own sub company (assigned_sub_id = subId)
  const { data: rows } = await admin
    .from('files')
    .select('job_id, project_id, share_with_sub, photo_tag')
    .eq('storage_path', path)
  const candidates = (rows ?? []).filter(
    (r: { share_with_sub?: boolean | null; photo_tag?: string | null }) =>
      r.share_with_sub === true || String(r.photo_tag ?? '').startsWith('final_')
  ) as { job_id: string | null; project_id: string | null }[]
  if (candidates.length === 0) return false

  const jobIds = Array.from(new Set(candidates.map((r) => r.job_id).filter((v): v is string => !!v)))
  const projectIds = Array.from(new Set(candidates.map((r) => r.project_id).filter((v): v is string => !!v)))
  if (jobIds.length > 0) {
    // org-scope-ok: a sub reads only rows on jobs assigned to its own sub company (assigned_sub_id = subId)
    const { data } = await admin.from('production_jobs').select('id').in('id', jobIds).eq('assigned_sub_id', subId).limit(1)
    if ((data?.length ?? 0) > 0) return true
  }
  if (projectIds.length > 0) {
    // org-scope-ok: a sub reads only rows on jobs assigned to its own sub company (assigned_sub_id = subId)
    const { data } = await admin
      .from('production_jobs')
      .select('id')
      .in('project_id', projectIds)
      .eq('assigned_sub_id', subId)
      .limit(1)
    if ((data?.length ?? 0) > 0) return true
  }
  return false
}

export async function GET(request: Request) {
  let profile: User
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: PRIVATE })
  }

  try {
    const raw = new URL(request.url).searchParams.get('path')
    const path = filesPathFromStoredUrl(raw)
    if (!path) return notFound()

    const admin = createServiceClient()
    const c = classifyFilesPath(path)
    const isSubRole = String(profile.role ?? '').toLowerCase().trim() === 'sub'

    const allowed = isSubRole
      ? await subMayRead(admin, profile, path, c)
      : (await staffMayRead(admin, profile, path, c)) || (await subMayRead(admin, profile, path, c))
    if (!allowed) return notFound()

    const signedUrl = await signFilesObject(admin, path)
    if (!signedUrl) return notFound()

    return NextResponse.redirect(signedUrl, { status: 302, headers: PRIVATE })
  } catch (error) {
    console.error('[files/object] error:', error)
    return NextResponse.json({ error: 'Could not open file' }, { status: 500, headers: PRIVATE })
  }
}
