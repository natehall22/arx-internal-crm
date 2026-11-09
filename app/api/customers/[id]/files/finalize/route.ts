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

type Admin = ReturnType<typeof createServiceClient>
type RowKey = { fileId: string; orgId: string; customerId: string }

/**
 * POST /api/customers/[id]/files/finalize  { fileId, fileName }
 * Step 2: after the browser uploaded to the signed URL, confirm the object is really there (size and type come from storage,
 * not the browser), then write the `files` row with the storage PATH. The row id is the fileId, so a repeated finalize can't
 * create a second row.
 *
 * Whether the stored object was removed is said explicitly, never inferred from a status code. The client uploads again only
 * when the answer carries `removed: true` (413 always carries it):
 *  - 200 { file }            saved (also when an earlier attempt already saved this id)
 *  - 409                     a row with this id exists but could not be read back: treat as saved; object kept
 *  - 400                     no such object under this customer for this id (nothing to remove)
 *  - 400 { removed: true }   storage reported no size for the object; removed
 *  - 413 { removed: true }   over the limit; removed
 *  - 503                     storage could not be listed, or a bad object could not be removed: retry finalize
 *  - 500 { removed: true }   save failed, no row exists, and the object was removed
 *  - 500                     save failed and the object was kept (could not check or remove): retry finalize
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  let profile: User
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createServiceClient()
  // Set once the object is confirmed ours and before the insert; only then may a failed save remove it.
  let storedPath: string | null = null
  let key: RowKey | null = null

  const failSave = async () => {
    const outcome = key && storedPath ? await removeIfUnowned(admin, storedPath, key) : 'kept'
    if (outcome === 'row-exists') {
      try {
        const existing = key ? await readRow(admin, key) : null
        if (existing) return NextResponse.json({ file: existing })
      } catch {
        // fall through: saved, but not readable right now
      }
      return NextResponse.json({ error: 'Already saved' }, { status: 409 })
    }
    return outcome === 'removed'
      ? NextResponse.json({ error: 'Could not save the file', removed: true }, { status: 500 })
      : NextResponse.json({ error: 'Could not save the file' }, { status: 500 })
  }

  try {
    const access = await customerFileUploadAccess(admin, profile, params.id)
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

    const body = await request.json().catch(() => null)
    if (!isUuid(body?.fileId)) return NextResponse.json({ error: 'fileId is required' }, { status: 400 })
    const fileId: string = body.fileId
    key = { fileId, orgId: profile.org_id, customerId: params.id }

    let listError: string | null = null
    const found = await findStorageObjectByRecordPrefix(admin, CUSTOMER_FILES_BUCKET, customerFilesFolder(profile.org_id, params.id), fileId, {
      onListError: (m) => {
        listError = m
      },
    })
    if (!found && listError) {
      console.error('[customers/files/finalize] storage list failed:', listError)
      return NextResponse.json({ error: 'Storage is not answering — try again' }, { status: 503 })
    }
    if (!found || !isCustomerFilePathFor(found.storagePath, key)) {
      return NextResponse.json({ error: 'The upload did not arrive — try again' }, { status: 400 })
    }

    // Storage's own size is the only one trusted; no size reported means it can't be checked, so it isn't kept.
    if (found.size == null || found.size <= 0 || found.size > CUSTOMER_FILE_MAX_BYTES) {
      const tooBig = found.size != null && found.size > CUSTOMER_FILE_MAX_BYTES
      const removed = await removeStored(admin, found.storagePath)
      if (!removed) return NextResponse.json({ error: 'Could not check the upload — try again' }, { status: 503 })
      return tooBig
        ? NextResponse.json({ error: 'File is too large', removed: true }, { status: 413 })
        : NextResponse.json({ error: 'Could not check the upload — try again', removed: true }, { status: 400 })
    }
    storedPath = found.storagePath

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
      .select(ROW_COLUMNS)
      .single()

    if (error || !data) {
      // Duplicate key: a row with this id already exists — an earlier finalize saved it (double tap, or a retry after the
      // response was lost). The object belongs to that row: NEVER removed here, even if reading the row back fails.
      if (error?.code === '23505') {
        storedPath = null
        try {
          const existing = await readRow(admin, key)
          if (existing) return NextResponse.json({ file: existing })
        } catch (e) {
          console.error('[customers/files/finalize] read-back after duplicate key failed:', e)
        }
        return NextResponse.json({ error: 'Already saved' }, { status: 409 })
      }
      console.error('[customers/files/finalize] insert failed:', error?.message)
      return await failSave()
    }

    return NextResponse.json({ file: data })
  } catch (error) {
    console.error('[customers/files/finalize] error:', error)
    return await failSave()
  }
}

const ROW_COLUMNS = 'id, file_name, storage_path, mime_type, tag, created_at'

async function readRow(admin: Admin, k: RowKey) {
  const { data, error } = await admin.from('files').select(ROW_COLUMNS).eq('id', k.fileId).eq('org_id', k.orgId).eq('customer_id', k.customerId).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

/**
 * After a failed save: if a row for this id exists after all (the insert reported an error but committed, or a parallel
 * finalize won), the object is that row's and is kept. Only when no row is found is the object removed.
 */
async function removeIfUnowned(admin: Admin, path: string, k: RowKey): Promise<'row-exists' | 'removed' | 'kept'> {
  try {
    if (await readRow(admin, k)) return 'row-exists'
  } catch (e) {
    console.error('[customers/files/finalize] could not check for an existing row; keeping the object:', e)
    return 'kept'
  }
  return (await removeStored(admin, path)) ? 'removed' : 'kept'
}

/** Remove one stored object. True only when storage reports no error. */
async function removeStored(admin: Admin, path: string): Promise<boolean> {
  try {
    const { error } = await admin.storage.from(CUSTOMER_FILES_BUCKET).remove([path])
    if (error) {
      console.error('[customers/files/finalize] could not remove the stored object:', error.message ?? error)
      return false
    }
    return true
  } catch (e) {
    console.error('[customers/files/finalize] could not remove the stored object:', e)
    return false
  }
}
