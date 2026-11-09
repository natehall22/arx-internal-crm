import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import {
  CUSTOMER_FILES_BUCKET,
  CUSTOMER_FILE_MAX_BYTES,
  customerFileDisplayName,
  customerFileTag,
  customerFilesFolder,
  isCustomerFilePathFor,
} from '@/lib/customer-file/customer-files'
import { customerFileUploadAccess } from '@/lib/customer-file/customer-files-access'
import { findStorageObjectByRecordPrefix } from '@/lib/files/direct-upload-utils'
import { createServiceClient } from '@/lib/supabase/service'
import { isUuid } from '@/lib/uuid'
import type { User } from '@/lib/types/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/customers/[id]/files/finalize  { fileId, fileName }
 * Step 2: after the browser uploaded to the signed URL, confirm the object is really there (size and type come from storage,
 * not the browser), then write the `files` row with the storage PATH. The row id is the fileId, so a repeated finalize can't
 * create a second row.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  let profile: User
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createServiceClient()
    const access = await customerFileUploadAccess(admin, profile, params.id)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const body = await request.json().catch(() => null)
    const fileId = body?.fileId
    if (!isUuid(fileId)) return NextResponse.json({ error: 'fileId is required' }, { status: 400 })

    const folder = customerFilesFolder(profile.org_id, params.id)
    const found = await findStorageObjectByRecordPrefix(admin, CUSTOMER_FILES_BUCKET, folder, fileId)
    if (!found || !isCustomerFilePathFor(found.storagePath, { orgId: profile.org_id, customerId: params.id, fileId })) {
      return NextResponse.json({ error: 'The upload did not arrive — try again' }, { status: 400 })
    }
    // Storage's own size is the only one trusted; no size reported means it can't be checked, so it isn't kept.
    if (found.size == null || found.size <= 0 || found.size > CUSTOMER_FILE_MAX_BYTES) {
      await admin.storage.from(CUSTOMER_FILES_BUCKET).remove([found.storagePath])
      return found.size == null || found.size <= 0
        ? NextResponse.json({ error: 'Could not check the upload — try again' }, { status: 400 })
        : NextResponse.json({ error: 'File is too large' }, { status: 413 })
    }

    const fileName = customerFileDisplayName(body?.fileName ?? found.displayFilename)
    const mimeType = found.mimeType || 'application/octet-stream'
    const { data, error } = await admin
      .from('files')
      .insert({
        id: fileId,
        org_id: profile.org_id,
        customer_id: params.id,
        user_id: profile.id,
        storage_path: found.storagePath,
        file_name: fileName,
        mime_type: mimeType,
        tag: customerFileTag(mimeType, fileName),
      })
      .select('id, file_name, storage_path, mime_type, tag, created_at')
      .single()

    if (error || !data) {
      // A repeat finalize for a row that already exists is a success, not an error (double tap, retry after a timeout).
      if (error?.code === '23505') {
        const { data: existing } = await admin
          .from('files')
          .select('id, file_name, storage_path, mime_type, tag, created_at')
          .eq('id', fileId)
          .eq('org_id', profile.org_id)
          .eq('customer_id', params.id)
          .maybeSingle()
        if (existing) return NextResponse.json({ file: existing })
      }
      console.error('[customers/files/finalize] insert failed:', error?.message)
      await admin.storage.from(CUSTOMER_FILES_BUCKET).remove([found.storagePath])
      return NextResponse.json({ error: 'Could not save the file' }, { status: 500 })
    }

    return NextResponse.json({ file: data })
  } catch (error) {
    console.error('[customers/files/finalize] error:', error)
    return NextResponse.json({ error: 'Could not save the file' }, { status: 500 })
  }
}
