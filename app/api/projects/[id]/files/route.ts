import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const projectId = params.id
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const tag = String(formData.get('tag') || 'document')

    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 })
    }

    // Validate org and project access
    const { data: profile } = await supabase
      .from('users')
      .select('id, org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const { data: project } = await supabase
      .from('projects')
      .select('id, org_id')
      .eq('id', projectId)
      .eq('org_id', profile.org_id)
      .single()

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const safeFileName = file.name.replace(/\s+/g, '_')
    const storagePath = `org/${profile.org_id}/projects/${projectId}/${Date.now()}-${safeFileName}`

    const { error: uploadError } = await supabase.storage
      .from('files')
      .upload(storagePath, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    const { data: inserted, error: insertError } = await supabase
      .from('files')
      .insert({
        org_id: profile.org_id,
        project_id: projectId,
        file_name: file.name,
        storage_path: storagePath,
        mime_type: file.type,
        size_bytes: file.size,
        tag,
        uploaded_by: user.id,
      })
      .select('id')
      .single()

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, id: inserted.id })
  } catch (error) {
    console.error('Project file upload API error:', error)
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })
  }
}
