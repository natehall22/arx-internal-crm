import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { upsertCustomer } from '@/lib/customers'

// POST - Backfill customer_id for projects and jobs that are missing it
export async function POST(request: Request) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    // Only admins can run backfill
    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const results = {
      projects_processed: 0,
      projects_linked: 0,
      jobs_processed: 0,
      jobs_linked: 0,
      errors: [] as string[],
    }

    // Find projects without customer_id
    const { data: projects } = await adminClient
      .from('projects')
      .select('id, address_text')
      .eq('org_id', profile.org_id)
      .is('customer_id', null)

    for (const project of projects || []) {
      results.projects_processed++
      
      try {
        // Try to get customer info from proposal first
        const { data: proposal } = await adminClient
          .from('proposals')
          .select('customer_name, customer_email, customer_phone, customer_address')
          .eq('project_id', project.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        let customerData = null

        if (proposal?.customer_name) {
          customerData = {
            name: proposal.customer_name,
            email: proposal.customer_email,
            phone: proposal.customer_phone,
            address_text: proposal.customer_address || project.address_text,
          }
        } else {
          // Fallback: try to get from lead
          const { data: projectWithLead } = await adminClient
            .from('projects')
            .select('lead:leads(homeowner_name, email, phone)')
            .eq('id', project.id)
            .single()

          const lead = projectWithLead?.lead 
            ? (Array.isArray(projectWithLead.lead) ? projectWithLead.lead[0] : projectWithLead.lead)
            : null

          if (lead?.homeowner_name) {
            customerData = {
              name: lead.homeowner_name,
              email: lead.email,
              phone: lead.phone,
              address_text: project.address_text,
            }
          }
        }

        if (customerData && customerData.name) {
          // Upsert customer (finds existing or creates new)
          const { customer_id } = await upsertCustomer(adminClient, profile.org_id, customerData)

          // Update project
          await adminClient
            .from('projects')
            .update({ customer_id })
            .eq('id', project.id)

          // Update any associated jobs
          await adminClient
            .from('production_jobs')
            .update({ customer_id })
            .eq('project_id', project.id)
            .eq('org_id', profile.org_id)

          results.projects_linked++
        }
      } catch (err) {
        results.errors.push(`Project ${project.id}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    // Find jobs without customer_id that weren't updated via project
    const { data: jobs } = await adminClient
      .from('production_jobs')
      .select('id, address_text, project_id')
      .eq('org_id', profile.org_id)
      .is('customer_id', null)

    for (const job of jobs || []) {
      results.jobs_processed++
      
      try {
        let customerData = null

        // Try to get customer info from proposal via project
        if (job.project_id) {
          const { data: proposal } = await adminClient
            .from('proposals')
            .select('customer_name, customer_email, customer_phone, customer_address')
            .eq('project_id', job.project_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()

          if (proposal?.customer_name) {
            customerData = {
              name: proposal.customer_name,
              email: proposal.customer_email,
              phone: proposal.customer_phone,
              address_text: proposal.customer_address || job.address_text,
            }
          } else {
            // Fallback: try to get from lead via project
            const { data: projectWithLead } = await adminClient
              .from('projects')
              .select('lead:leads(homeowner_name, email, phone)')
              .eq('id', job.project_id)
              .single()

            const lead = projectWithLead?.lead 
              ? (Array.isArray(projectWithLead.lead) ? projectWithLead.lead[0] : projectWithLead.lead)
              : null

            if (lead?.homeowner_name) {
              customerData = {
                name: lead.homeowner_name,
                email: lead.email,
                phone: lead.phone,
                address_text: job.address_text,
              }
            }
          }
        }

        if (customerData && customerData.name) {
          // Upsert customer
          const { customer_id } = await upsertCustomer(adminClient, profile.org_id, customerData)

          // Update job
          await adminClient
            .from('production_jobs')
            .update({ customer_id })
            .eq('id', job.id)

          // Also update project if it exists
          if (job.project_id) {
            await adminClient
              .from('projects')
              .update({ customer_id })
              .eq('id', job.project_id)
              .is('customer_id', null)
          }

          results.jobs_linked++
        }
      } catch (err) {
        results.errors.push(`Job ${job.id}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    return NextResponse.json({
      success: true,
      results,
      message: `Linked ${results.projects_linked}/${results.projects_processed} projects and ${results.jobs_linked}/${results.jobs_processed} jobs`,
    })

  } catch (error) {
    console.error('Error in POST /api/admin/backfill-customers:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// GET - Preview what would be backfilled (dry run)
export async function GET(request: Request) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Count projects without customer_id
    const { count: projectsCount } = await adminClient
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', profile.org_id)
      .is('customer_id', null)

    // Count jobs without customer_id
    const { count: jobsCount } = await adminClient
      .from('production_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', profile.org_id)
      .is('customer_id', null)

    return NextResponse.json({
      projects_without_customer: projectsCount || 0,
      jobs_without_customer: jobsCount || 0,
      message: `Found ${projectsCount || 0} projects and ${jobsCount || 0} jobs without linked customers`,
    })

  } catch (error) {
    console.error('Error in GET /api/admin/backfill-customers:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
