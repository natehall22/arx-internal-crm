import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

// GET: Get single file with fresh signed URL
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; fileId: string } }
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

  const { fileId } = params
  const jobId = params.id


  // Get file record
  const { data: file, error } = await supabase
    .from('job_files')
    .select(`
      *,
      created_by_user:users!job_files_created_by_fkey(full_name),
      signed_by_user:users!job_files_signed_by_fkey(full_name)
    `)
    .eq('id', fileId)
    .eq('job_id', jobId)
    .eq('org_id', profile.org_id)
    .single()

  if (error || !file) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  // Generate fresh signed URL
  const { data: signedUrl } = await supabase.storage
    .from('job-files')
    .createSignedUrl(file.storage_key, 3600)

  return NextResponse.json({
    file: {
      ...file,
      signed_url: signedUrl?.signedUrl || null,
    },
  })
}

// PATCH: Update file metadata (mark as signed, add notes, etc.)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; fileId: string } }
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

  const { fileId } = params
  const jobId = params.id
  const body = await request.json()


  // Verify file exists and belongs to user's org
  const { data: existingFile } = await supabase
    .from('job_files')
    .select('id')
    .eq('id', fileId)
    .eq('job_id', jobId)
    .eq('org_id', profile.org_id)
    .single()

  if (!existingFile) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  // Build update object
  const updates: Record<string, any> = {}
  
  if (body.file_name !== undefined) updates.file_name = body.file_name
  if (body.notes !== undefined) updates.notes = body.notes
  
  // Handle signing
  if (body.is_signed === true) {
    updates.is_signed = true
    updates.signed_at = new Date().toISOString()
    updates.signed_by = profile.id
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  // Update file
  const { data: file, error } = await supabase
    .from('job_files')
    .update(updates)
    .eq('id', fileId)
    .select(`
      *,
      created_by_user:users!job_files_created_by_fkey(full_name),
      signed_by_user:users!job_files_signed_by_fkey(full_name)
    `)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ file })
}

// DELETE: Delete a file (admin/manager only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; fileId: string } }
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

  const { fileId } = params
  const jobId = params.id


  // Only admin/manager can delete
  if (!['admin', 'sales_manager', 'regional_manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  }

  // Get file to delete
  const { data: file } = await supabase
    .from('job_files')
    .select('id, storage_key')
    .eq('id', fileId)
    .eq('job_id', jobId)
    .eq('org_id', profile.org_id)
    .single()

  if (!file) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  // Delete from storage
  const { error: storageError } = await supabase.storage
    .from('job-files')
    .remove([file.storage_key])

  if (storageError) {
    console.error('Storage delete error:', storageError)
    // Continue anyway - metadata should still be deleted
  }

  // Delete metadata record
  const { error } = await supabase
    .from('job_files')
    .delete()
    .eq('id', fileId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
