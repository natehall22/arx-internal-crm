import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

// GET: List all files for a job + generate signed URLs
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // RLS-bound client: this route's reads/writes rely on the org policies on the
  // tables below, so it must stay the caller's client rather than a service client.
  const supabase = createClient()

  const jobId = params.id


  // Verify job belongs to user's org
  const { data: job } = await supabase
    .from('jobs')
    .select('id, org_id')
    .eq('id', jobId)
    .eq('org_id', profile.org_id)
    .single()

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  // Get all files for this job
  const { data: files, error } = await supabase
    .from('job_files')
    .select(`
      *,
      created_by_user:users!job_files_created_by_fkey(full_name),
      signed_by_user:users!job_files_signed_by_fkey(full_name)
    `)
    .eq('job_id', jobId)
    .order('file_type')
    .order('version', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Generate signed URLs for each file
  const filesWithUrls = await Promise.all(
    (files || []).map(async (file) => {
      const { data: signedUrl } = await supabase.storage
        .from('job-files')
        .createSignedUrl(file.storage_key, 3600) // 1 hour expiry

      return {
        ...file,
        signed_url: signedUrl?.signedUrl || null,
      }
    })
  )

  return NextResponse.json({ files: filesWithUrls })
}

// POST: Upload a new file or create metadata for generated PDF
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // RLS-bound client: this route's reads/writes rely on the org policies on the
  // tables below, so it must stay the caller's client rather than a service client.
  const supabase = createClient()

  const jobId = params.id


  // Verify job belongs to user's org
  const { data: job } = await supabase
    .from('jobs')
    .select('id, org_id')
    .eq('id', jobId)
    .eq('org_id', profile.org_id)
    .single()

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const contentType = request.headers.get('content-type') || ''

  // Handle JSON metadata (for server-generated PDFs)
  if (contentType.includes('application/json')) {
    const body = await request.json()
    const { file_type, file_name, storage_key, file_size, notes } = body

    if (!file_type || !storage_key) {
      return NextResponse.json(
        { error: 'file_type and storage_key are required' },
        { status: 400 }
      )
    }

    // Get next version number
    const { data: versionData } = await supabase.rpc('get_next_job_file_version', {
      p_job_id: jobId,
      p_file_type: file_type,
    })

    const version = versionData || 1

    // Create metadata record
    const { data: fileRecord, error } = await supabase
      .from('job_files')
      .insert({
        org_id: profile.org_id,
        job_id: jobId,
        file_type,
        storage_key,
        file_name: file_name || `${file_type}.pdf`,
        file_size,
        version,
        notes,
        created_by: profile.id,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Generate signed URL
    const { data: signedUrl } = await supabase.storage
      .from('job-files')
      .createSignedUrl(storage_key, 3600)

    return NextResponse.json({
      file: fileRecord,
      signed_url: signedUrl?.signedUrl,
    })
  }

  // Handle multipart form data (direct file upload)
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const fileType = formData.get('file_type') as string
    const fileName = formData.get('file_name') as string
    const notes = formData.get('notes') as string

    if (!file || !fileType) {
      return NextResponse.json(
        { error: 'file and file_type are required' },
        { status: 400 }
      )
    }

    // Get next version number
    const { data: versionData } = await supabase.rpc('get_next_job_file_version', {
      p_job_id: jobId,
      p_file_type: fileType,
    })

    const version = versionData || 1

    // Generate storage key
    const extension = file.name.split('.').pop() || 'pdf'
    const storageKey = version === 1
      ? `orgs/${profile.org_id}/jobs/${jobId}/${fileType}.${extension}`
      : `orgs/${profile.org_id}/jobs/${jobId}/${fileType}_v${version}.${extension}`

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from('job-files')
      .upload(storageKey, file, {
        contentType: file.type,
        upsert: true,
      })

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    // Create metadata record
    const { data: fileRecord, error } = await supabase
      .from('job_files')
      .insert({
        org_id: profile.org_id,
        job_id: jobId,
        file_type: fileType,
        storage_key: storageKey,
        file_name: fileName || file.name,
        file_size: file.size,
        mime_type: file.type,
        version,
        notes,
        created_by: profile.id,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Generate signed URL
    const { data: signedUrl } = await supabase.storage
      .from('job-files')
      .createSignedUrl(storageKey, 3600)

    return NextResponse.json({
      file: fileRecord,
      signed_url: signedUrl?.signedUrl,
    })
  }

  return NextResponse.json({ error: 'Invalid content type' }, { status: 400 })
}
