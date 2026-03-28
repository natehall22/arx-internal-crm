import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

const BUCKET = 'inspection-photos'
const MAX_PHOTOS = 20

const ROLES_CAN_UPLOAD = new Set([
  'admin', 'owner', 'setter_manager', 'regional_setter_manager',
  'sales_manager', 'regional_manager', 'rep',
])

// GET — list photos for this opportunity's inspection result (with signed URLs)
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const admin = createServiceClient()

    const { data: result } = await admin
      .from('inspection_results')
      .select('id')
      .eq('opportunity_id', params.id)
      .eq('org_id', profile.org_id)
      .maybeSingle()

    if (!result) {
      return NextResponse.json({ photos: [] })
    }

    const { data: rows, error } = await admin
      .from('inspection_result_photos')
      .select('id, storage_path, filename, created_at')
      .eq('result_id', result.id)
      .eq('org_id', profile.org_id)
      .order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Generate 7-day signed URLs for all photos
    const photos = await Promise.all(
      (rows || []).map(async (row) => {
        const { data: signed } = await admin.storage
          .from(BUCKET)
          .createSignedUrl(row.storage_path, 60 * 60 * 24 * 7) // 7 days
        return {
          id: row.id,
          storage_path: row.storage_path,
          filename: row.filename,
          created_at: row.created_at,
          url: signed?.signedUrl ?? null,
        }
      })
    )

    return NextResponse.json({ photos })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — upload a single compressed photo
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()

    if (!ROLES_CAN_UPLOAD.has(profile.role)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    const admin = createServiceClient()

    // Resolve or create the inspection_results row so we have a result_id
    let { data: result } = await admin
      .from('inspection_results')
      .select('id')
      .eq('opportunity_id', params.id)
      .eq('org_id', profile.org_id)
      .maybeSingle()

    if (!result) {
      // Draft row — outcome will be filled in when the form is submitted
      const { data: created, error: createErr } = await admin
        .from('inspection_results')
        .insert({
          org_id: profile.org_id,
          opportunity_id: params.id,
          submitted_by_user_id: profile.id,
          outcome: 'approved', // placeholder; overwritten on form submit
        })
        .select('id')
        .single()

      if (createErr || !created) {
        return NextResponse.json({ error: 'Failed to create result record' }, { status: 500 })
      }
      result = created
    }

    // Enforce max photo count
    const { count } = await admin
      .from('inspection_result_photos')
      .select('id', { count: 'exact', head: true })
      .eq('result_id', result.id)
      .eq('org_id', profile.org_id)

    if ((count ?? 0) >= MAX_PHOTOS) {
      return NextResponse.json({ error: `Maximum ${MAX_PHOTOS} photos allowed` }, { status: 400 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image files are allowed' }, { status: 400 })
    }

    // Sanitize filename
    const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
    const photoId = crypto.randomUUID()
    const storagePath = `${profile.org_id}/${params.id}/${photoId}_${safeFilename}`

    const fileBuffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      console.error('Photo upload error:', uploadError)
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
    }

    const { data: row, error: insertError } = await admin
      .from('inspection_result_photos')
      .insert({
        org_id: profile.org_id,
        result_id: result.id,
        storage_path: storagePath,
        filename: safeFilename,
      })
      .select('id, storage_path, filename, created_at')
      .single()

    if (insertError) {
      // Clean up orphaned storage object
      await admin.storage.from(BUCKET).remove([storagePath])
      return NextResponse.json({ error: 'Failed to save photo record' }, { status: 500 })
    }

    return NextResponse.json({ photo: row })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
