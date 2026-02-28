import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { profile } = await requireAuth()
    const supabase = createClient()
    const body = await request.json()

    const { project_id } = body

    if (!project_id) {
      return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
    }

    // Verify project exists and user has access
    let projectQuery = supabase
      .from('projects')
      .select('id, org_id, owner_user_id')
      .eq('id', project_id)
      .eq('org_id', profile.org_id)

    if (profile.role === 'rep') {
      projectQuery = projectQuery.eq('owner_user_id', profile.id)
    }

    const { data: project, error: projectError } = await projectQuery.single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Create the estimate
    const { data: estimate, error } = await supabase
      .from('estimates')
      .insert({
        org_id: profile.org_id,
        project_id: project_id,
        status: 'draft',
        steep_multiplier_pct: 0,
        high_multiplier_pct: 0,
        tax_rate: 0.08,
        discount_amount: 0,
        subtotal: 0,
        tax: 0,
        total: 0,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating estimate:', error)
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json(estimate)
  } catch (error) {
    console.error('Estimate creation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create estimate' },
      { status: 500 }
    )
  }
}
