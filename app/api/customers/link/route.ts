import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { upsertCustomer } from '@/lib/customers'
import { canEditCustomerRecordsFromPermissionNames } from '@/lib/permissions'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'

export const dynamic = 'force-dynamic'

// POST - Link existing customer to a source record OR create from source
export async function POST(request: Request) {
  try {
    const supabase = createClient()
    const adminClient = createServiceClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role, custom_role_id')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const customerPermissions = await resolveEffectivePermissionNames(adminClient, user.id, profile)
    if (!canEditCustomerRecordsFromPermissionNames(customerPermissions)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { action, customer_id, source_type, source_id, customer_data, link_target_type, link_target_id } = body

    // Validate source type
    const validSourceTypes = ['opportunity', 'project', 'job']
    if (source_type && !validSourceTypes.includes(source_type)) {
      return NextResponse.json({ error: 'Invalid source type' }, { status: 400 })
    }
    if (link_target_type && !validSourceTypes.includes(link_target_type)) {
      return NextResponse.json({ error: 'Invalid link_target_type' }, { status: 400 })
    }

    let finalCustomerId = customer_id

    // Action: link - Link existing customer to source record
    if (action === 'link') {
      if (!customer_id || !source_type || !source_id) {
        return NextResponse.json({ error: 'customer_id, source_type, and source_id required' }, { status: 400 })
      }

      // Verify customer exists and belongs to org
      const { data: customer } = await adminClient
        .from('customers')
        .select('id')
        .eq('id', customer_id)
        .eq('org_id', profile.org_id)
        .single()

      if (!customer) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
      }
    }

    // Action: create_from_source - Create customer from source record data
    if (action === 'create_from_source') {
      if (!source_type || !source_id) {
        return NextResponse.json({ error: 'source_type and source_id required' }, { status: 400 })
      }

      // Get source record data
      let sourceData: any = null

      if (source_type === 'opportunity') {
        const { data } = await adminClient
          .from('opportunities')
          .select('contact_name, contact_email, contact_phone, address_text, lead_id')
          .eq('id', source_id)
          .eq('org_id', profile.org_id)
          .single()
        
        if (data) {
          let leadName: string | null = null
          let leadEmail: string | null = null
          let leadPhone: string | null = null
          if (data.lead_id) {
            const { data: lead } = await adminClient
              .from('leads')
              .select('homeowner_name, email, phone')
              .eq('id', data.lead_id)
              .eq('org_id', profile.org_id)
              .maybeSingle()
            leadName = lead?.homeowner_name || null
            leadEmail = lead?.email || null
            leadPhone = lead?.phone || null
          }

          sourceData = {
            name: data.contact_name || leadName,
            email: data.contact_email || leadEmail,
            phone: data.contact_phone || leadPhone,
            address_text: data.address_text,
          }
        }
      } else if (source_type === 'project') {
        const { data } = await adminClient
          .from('projects')
          .select('id, address_text')
          .eq('id', source_id)
          .eq('org_id', profile.org_id)
          .single()
        
        if (data) {
          // Try to get customer info from proposal first
          const { data: proposal } = await adminClient
            .from('proposals')
            .select('customer_name, customer_email, customer_phone, customer_address')
            .eq('project_id', data.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()

          if (proposal?.customer_name) {
            sourceData = {
              name: proposal.customer_name,
              email: proposal.customer_email,
              phone: proposal.customer_phone,
              address_text: proposal.customer_address || data.address_text,
            }
          } else {
            // Fallback to lead
            const { data: projectWithLead } = await adminClient
              .from('projects')
              .select('lead:leads(homeowner_name, email, phone)')
              .eq('id', source_id)
              .single()
            
            const lead = projectWithLead?.lead 
              ? (Array.isArray(projectWithLead.lead) ? projectWithLead.lead[0] : projectWithLead.lead)
              : null
            sourceData = {
              name: lead?.homeowner_name,
              email: lead?.email,
              phone: lead?.phone,
              address_text: data.address_text,
            }
          }
        }
      } else if (source_type === 'job') {
        const { data } = await adminClient
          .from('production_jobs')
          .select('address_text, project_id')
          .eq('id', source_id)
          .eq('org_id', profile.org_id)
          .single()
        
        if (data) {
          // Try to get customer info from proposal first
          if (data.project_id) {
            const { data: proposal } = await adminClient
              .from('proposals')
              .select('customer_name, customer_email, customer_phone, customer_address')
              .eq('project_id', data.project_id)
              .order('created_at', { ascending: false })
              .limit(1)
              .single()

            if (proposal?.customer_name) {
              sourceData = {
                name: proposal.customer_name,
                email: proposal.customer_email,
                phone: proposal.customer_phone,
                address_text: proposal.customer_address || data.address_text,
              }
            }
          }
          
          // Fallback to lead if no proposal
          if (!sourceData) {
            const { data: jobWithProject } = await adminClient
              .from('production_jobs')
              .select('project:projects(lead:leads(homeowner_name, email, phone))')
              .eq('id', source_id)
              .single()
            
            const project = jobWithProject?.project 
              ? (Array.isArray(jobWithProject.project) ? jobWithProject.project[0] : jobWithProject.project)
              : null
            const lead = project?.lead 
              ? (Array.isArray(project.lead) ? project.lead[0] : project.lead) 
              : null
            sourceData = {
              name: lead?.homeowner_name,
              email: lead?.email,
              phone: lead?.phone,
              address_text: data.address_text,
            }
          }
        }
      }

      if (!sourceData || !sourceData.name) {
        return NextResponse.json({ error: 'Could not extract customer data from source' }, { status: 400 })
      }

      // Upsert customer (finds existing or creates new)
      const result = await upsertCustomer(adminClient, profile.org_id, sourceData)
      finalCustomerId = result.customer_id
    }

    // Action: create_manual - Create customer from manual input (advanced)
    if (action === 'create_manual') {
      if (!customer_data?.name) {
        return NextResponse.json({ error: 'Customer name required' }, { status: 400 })
      }

      const result = await upsertCustomer(adminClient, profile.org_id, {
        name: customer_data.name,
        email: customer_data.email,
        phone: customer_data.phone,
        address_text: customer_data.address_text,
      })
      finalCustomerId = result.customer_id
    }

    // Update target source record with customer_id.
    // For create_from_source we may read data from one record but link to another target (e.g. project "change" flow).
    const targetSourceType = (link_target_type || source_type) as string | undefined
    const targetSourceId = (link_target_id || source_id) as string | undefined

    if (finalCustomerId && targetSourceType && targetSourceId) {
      const tableMap: Record<string, string> = {
        opportunity: 'opportunities',
        project: 'projects',
        job: 'production_jobs',
      }

      const table = tableMap[targetSourceType]
      if (table) {
        const { error: updateError } = await adminClient
          .from(table)
          .update({ customer_id: finalCustomerId })
          .eq('id', targetSourceId)
          .eq('org_id', profile.org_id)

        if (updateError) {
          console.error('Error updating source record:', updateError)
          return NextResponse.json({ error: 'Failed to link customer to source' }, { status: 500 })
        }

        // If linking to project, also update the directly-linked opportunity/job/lead.
        // Scope to opportunity_id (not all opps under lead) to avoid cross-contamination.
        if (targetSourceType === 'project') {
          await adminClient
            .from('production_jobs')
            .update({ customer_id: finalCustomerId })
            .eq('project_id', targetSourceId)
            .eq('org_id', profile.org_id)

          const { data: project } = await adminClient
            .from('projects')
            .select('lead_id, opportunity_id')
            .eq('id', targetSourceId)
            .eq('org_id', profile.org_id)
            .maybeSingle()

          if (project?.lead_id) {
            await adminClient
              .from('leads')
              .update({ customer_id: finalCustomerId })
              .eq('id', project.lead_id)
              .eq('org_id', profile.org_id)
          }

          if (project?.opportunity_id) {
            await adminClient
              .from('opportunities')
              .update({ customer_id: finalCustomerId })
              .eq('id', project.opportunity_id)
              .eq('org_id', profile.org_id)
          }
        }

        // If linking to opportunity, keep lead + directly-linked project/jobs in sync.
        // Scope to projects.opportunity_id (not all projects under lead) to avoid cross-contamination.
        if (targetSourceType === 'opportunity') {
          const { data: opportunity } = await adminClient
            .from('opportunities')
            .select('lead_id')
            .eq('id', targetSourceId)
            .eq('org_id', profile.org_id)
            .maybeSingle()

          if (opportunity?.lead_id) {
            await adminClient
              .from('leads')
              .update({ customer_id: finalCustomerId })
              .eq('id', opportunity.lead_id)
              .eq('org_id', profile.org_id)

            const { data: projects } = await adminClient
              .from('projects')
              .select('id')
              .eq('opportunity_id', targetSourceId)
              .eq('org_id', profile.org_id)

            const projectIds = (projects || []).map((p: any) => p.id).filter(Boolean)
            if (projectIds.length > 0) {
              await adminClient
                .from('projects')
                .update({ customer_id: finalCustomerId })
                .in('id', projectIds)
                .eq('org_id', profile.org_id)

              await adminClient
                .from('production_jobs')
                .update({ customer_id: finalCustomerId })
                .in('project_id', projectIds)
                .eq('org_id', profile.org_id)
            }
          }
        }

        // If linking to job, also update the parent project + its directly-linked opportunity/lead.
        if (targetSourceType === 'job') {
          const { data: job } = await adminClient
            .from('production_jobs')
            .select('project_id')
            .eq('id', targetSourceId)
            .single()

          if (job?.project_id) {
            await adminClient
              .from('projects')
              .update({ customer_id: finalCustomerId })
              .eq('id', job.project_id)
              .eq('org_id', profile.org_id)

            const { data: project } = await adminClient
              .from('projects')
              .select('lead_id, opportunity_id')
              .eq('id', job.project_id)
              .eq('org_id', profile.org_id)
              .maybeSingle()

            if (project?.lead_id) {
              await adminClient
                .from('leads')
                .update({ customer_id: finalCustomerId })
                .eq('id', project.lead_id)
                .eq('org_id', profile.org_id)
            }

            if (project?.opportunity_id) {
              await adminClient
                .from('opportunities')
                .update({ customer_id: finalCustomerId })
                .eq('id', project.opportunity_id)
                .eq('org_id', profile.org_id)
            }
          }
        }
      }
    }

    // Get the final customer data
    const { data: customer } = await adminClient
      .from('customers')
      .select('*')
      .eq('id', finalCustomerId)
      .single()

    return NextResponse.json({ 
      success: true, 
      customer,
      linked_to: targetSourceType && targetSourceId ? { type: targetSourceType, id: targetSourceId } : null,
    })

  } catch (error) {
    console.error('Error in POST /api/customers/link:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
