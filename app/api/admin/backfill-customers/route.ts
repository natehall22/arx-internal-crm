import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { upsertCustomer } from '@/lib/customers'

/**
 * POST /api/admin/backfill-customers
 * 
 * Backfills customer records for existing projects that have proposals
 * but no customer_id set. Admin only.
 */
export async function POST() {
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

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Find projects without customer_id that have proposals
    const { data: projects } = await adminClient
      .from('projects')
      .select('id, org_id, customer_id, address_text')
      .eq('org_id', profile.org_id)
      .is('customer_id', null)

    if (!projects || projects.length === 0) {
      return NextResponse.json({ message: 'No projects need backfilling', updated: 0 })
    }

    let updated = 0
    const errors: string[] = []

    for (const project of projects) {
      // Find proposal for this project
      const { data: proposal } = await adminClient
        .from('proposals')
        .select('customer_name, customer_email, customer_phone, customer_address')
        .eq('project_id', project.id)
        .limit(1)
        .single()

      if (!proposal?.customer_name) {
        continue
      }

      try {
        const result = await upsertCustomer(adminClient, project.org_id, {
          name: proposal.customer_name,
          email: proposal.customer_email,
          phone: proposal.customer_phone,
          address_text: proposal.customer_address || project.address_text,
        })

        // Update project with customer_id
        await adminClient
          .from('projects')
          .update({ customer_id: result.customer_id })
          .eq('id', project.id)

        // Update any production_jobs for this project
        await adminClient
          .from('production_jobs')
          .update({ customer_id: result.customer_id })
          .eq('project_id', project.id)

        updated++
      } catch (err) {
        errors.push(`Project ${project.id}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    return NextResponse.json({
      message: `Backfill complete`,
      total_projects: projects.length,
      updated,
      errors: errors.length > 0 ? errors : undefined,
    })

  } catch (error) {
    console.error('Backfill customers error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
