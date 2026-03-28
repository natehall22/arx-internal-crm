import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

// DELETE - Delete a project
export async function DELETE(
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
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Only admins can delete projects
    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can delete projects' }, { status: 403 })
    }

    // Verify project exists and belongs to user's org
    const { data: existingProject, error: fetchError } = await adminClient
      .from('projects')
      .select('id, org_id, address_text')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (fetchError || !existingProject) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Check if there's an associated production job
    const { data: associatedJob } = await adminClient
      .from('production_jobs')
      .select('id, job_number')
      .eq('project_id', params.id)
      .single()

    if (associatedJob) {
      return NextResponse.json({ 
        error: `Cannot delete project - it has an associated production job (${associatedJob.job_number}). Delete the job first.` 
      }, { status: 400 })
    }

    // Delete associated records first (files, activities, estimates, etc.)
    await adminClient.from('files').delete().eq('project_id', params.id)
    await adminClient.from('activities').delete().eq('project_id', params.id)
    await adminClient.from('estimates').delete().eq('project_id', params.id)

    // Delete the project
    const { error: deleteError } = await adminClient
      .from('projects')
      .delete()
      .eq('id', params.id)
      .eq('org_id', profile.org_id)

    if (deleteError) {
      console.error('Error deleting project:', deleteError)
      return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'Project deleted successfully' })

  } catch (error) {
    console.error('Error in DELETE /api/projects/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Update a project
export async function PATCH(
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
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const body = await request.json()

    // Whitelist updateable fields to prevent mass-assignment
    const ALLOWED_FIELDS = new Set([
      'status', 'title', 'notes', 'address_text', 'owner_user_id', 'customer_id',
      'start_date', 'end_date', 'estimated_value', 'actual_value',
      'roof_type', 'square_footage', 'stories', 'slope', 'color', 'material',
      'insurance_claim_number', 'insurance_company', 'adjuster_name', 'adjuster_phone',
      'deductible', 'rcv', 'acv', 'pipeline_stage',
    ])
    const updateData: Record<string, unknown> = {}
    for (const key of Object.keys(body)) {
      if (ALLOWED_FIELDS.has(key)) updateData[key] = body[key]
    }
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    // Update the project
    const { data: updatedProject, error: updateError } = await adminClient
      .from('projects')
      .update(updateData)
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating project:', updateError)
      return NextResponse.json({ error: 'Failed to update project' }, { status: 500 })
    }

    return NextResponse.json({ success: true, project: updatedProject })

  } catch (error) {
    console.error('Error in PATCH /api/projects/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
