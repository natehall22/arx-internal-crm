import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // RLS-bound client: this route's reads/writes rely on the org policies on the
    // tables below, so it must stay the caller's client rather than a service client.
    const supabase = createClient()

    const projectId = params.id
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const tag = String(formData.get('tag') || 'document')

    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 })
    }


    if (!profile.org_id) {
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

    const basePayload = {
      org_id: profile.org_id,
      project_id: projectId,
      file_name: file.name,
      storage_path: storagePath,
      mime_type: file.type,
      tag,
    }

    const insertAttempts: Record<string, unknown>[] = [
      { ...basePayload, size_bytes: file.size, uploaded_by: profile.id },
      { ...basePayload, uploaded_by: profile.id },
      { ...basePayload, size_bytes: file.size, user_id: profile.id },
      { ...basePayload, user_id: profile.id },
    ]

    let inserted: { id: string } | null = null
    let lastInsertError: any = null

    for (const payload of insertAttempts) {
      const { data, error } = await supabase
        .from('files')
        .insert(payload)
        .select('id')
        .single()

      if (!error && data) {
        inserted = data
        lastInsertError = null
        break
      }

      lastInsertError = error
    }

    if (!inserted) {
      // Keep storage clean if metadata insert fails on all schema variants.
      await supabase.storage.from('files').remove([storagePath])
      return NextResponse.json(
        { error: lastInsertError?.message || 'Failed to save file record' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, id: inserted.id })
  } catch (error) {
    console.error('Project file upload API error:', error)
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })
  }
}
