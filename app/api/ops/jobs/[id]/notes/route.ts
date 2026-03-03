import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient()
    const adminClient = createServiceClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Verify job exists and belongs to user's org
    const { data: job, error: jobError } = await adminClient
      .from('production_jobs')
      .select('id, org_id')
      .eq('id', params.id)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Verify org match
    if (job.org_id !== profile.org_id) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Fetch notes with user info, newest first
    const { data: notes, error: notesError } = await adminClient
      .from('production_job_notes')
      .select(`
        id,
        note,
        created_at,
        user:users(full_name)
      `)
      .eq('job_id', params.id)
      .order('created_at', { ascending: false })

    if (notesError) {
      console.error('Error fetching notes:', notesError)
      return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 })
    }

    return NextResponse.json({ notes: notes || [] })

  } catch (error) {
    console.error('Error in GET /api/ops/jobs/[id]/notes:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient()
    const adminClient = createServiceClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, full_name')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Verify job exists and belongs to user's org
    const { data: job, error: jobError } = await adminClient
      .from('production_jobs')
      .select('id, org_id')
      .eq('id', params.id)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (job.org_id !== profile.org_id) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const body = await request.json()
    const { note } = body

    if (!note || typeof note !== 'string' || !note.trim()) {
      return NextResponse.json({ error: 'Note is required' }, { status: 400 })
    }

    // Insert the note
    const { data: newNote, error: insertError } = await adminClient
      .from('production_job_notes')
      .insert({
        job_id: params.id,
        user_id: user.id,
        note: note.trim(),
        is_internal: true,
      })
      .select(`
        id,
        note,
        created_at
      `)
      .single()

    if (insertError) {
      console.error('Error inserting note:', insertError)
      return NextResponse.json({ error: 'Failed to add note' }, { status: 500 })
    }

    // Return the note with user info
    return NextResponse.json({ 
      note: {
        ...newNote,
        user: { full_name: profile.full_name }
      }
    })

  } catch (error) {
    console.error('Error in POST /api/ops/jobs/[id]/notes:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
