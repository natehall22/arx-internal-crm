import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import {
  CUSTOMER_FILES_BUCKET,
  CUSTOMER_FILE_MAX_BYTES,
  customerFileStoragePath,
} from '@/lib/customer-file/customer-files'
import { customerFileUploadAccess } from '@/lib/customer-file/customer-files-access'
import { signedUploadTokenForPath } from '@/lib/files/signed-upload'
import { createServiceClient } from '@/lib/supabase/service'
import type { User } from '@/lib/types/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/customers/[id]/files/register  { fileName, size }
 * Step 1 of adding a file to a customer: checks access, picks the storage path and returns a one-time signed upload token for
 * the private `files` bucket. The browser uploads straight to storage, then calls ./finalize. Rules: lib/customer-file/customer-files.ts.
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
    const fileName = typeof body?.fileName === 'string' ? body.fileName.trim() : ''
    if (!fileName) return NextResponse.json({ error: 'fileName is required' }, { status: 400 })
    const size = typeof body?.size === 'number' ? body.size : NaN
    if (!Number.isFinite(size) || size <= 0) return NextResponse.json({ error: 'The file is empty' }, { status: 400 })
    if (size > CUSTOMER_FILE_MAX_BYTES) {
      return NextResponse.json({ error: `Files must be ${Math.round(CUSTOMER_FILE_MAX_BYTES / 1024 / 1024)} MB or smaller` }, { status: 413 })
    }

    const fileId = crypto.randomUUID()
    const storagePath = customerFileStoragePath({ orgId: profile.org_id, customerId: params.id, fileId, fileName })
    const signed = await signedUploadTokenForPath(admin, CUSTOMER_FILES_BUCKET, storagePath)
    if ('error' in signed) {
      console.error('[customers/files/register] signed upload failed:', signed.error)
      return NextResponse.json({ error: 'Could not start the upload' }, { status: 500 })
    }

    return NextResponse.json({ fileId, storagePath, bucket: CUSTOMER_FILES_BUCKET, signedUploadToken: signed.token })
  } catch (error) {
    console.error('[customers/files/register] error:', error)
    return NextResponse.json({ error: 'Could not start the upload' }, { status: 500 })
  }
}
