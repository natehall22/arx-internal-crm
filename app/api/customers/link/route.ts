import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { upsertCustomer } from '@/lib/customers'

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
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const body = await request.json()
    const { action, customer_id, source_type, source_id, customer_data } = body

    // Validate source type
    const validSourceTypes = ['opportunity', 'project', 'job']
    if (source_type && !validSourceTypes.includes(source_type)) {
      return NextResponse.json({ error: 'Invalid source type' }, { status: 400 })
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
          .select('contact_name, contact_email, contact_phone, address_text')
          .eq('id', source_id)
          .eq('org_id', profile.org_id)
          .single()
        
        if (data) {
          sourceData = {
            name: data.contact_name,
            email: data.contact_email,
            phone: data.contact_phone,
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

    // Update source record with customer_id
    if (finalCustomerId && source_type && source_id) {
      const tableMap: Record<string, string> = {
        opportunity: 'opportunities',
        project: 'projects',
        job: 'production_jobs',
      }

      const table = tableMap[source_type]
      if (table) {
        const { error: updateError } = await adminClient
          .from(table)
          .update({ customer_id: finalCustomerId })
          .eq('id', source_id)
          .eq('org_id', profile.org_id)

        if (updateError) {
          console.error('Error updating source record:', updateError)
          return NextResponse.json({ error: 'Failed to link customer to source' }, { status: 500 })
        }

        // If linking to project, also update any associated production_jobs
        if (source_type === 'project') {
          await adminClient
            .from('production_jobs')
            .update({ customer_id: finalCustomerId })
            .eq('project_id', source_id)
            .eq('org_id', profile.org_id)
        }

        // If linking to job, also update the parent project
        if (source_type === 'job') {
          const { data: job } = await adminClient
            .from('production_jobs')
            .select('project_id')
            .eq('id', source_id)
            .single()
          
          if (job?.project_id) {
            await adminClient
              .from('projects')
              .update({ customer_id: finalCustomerId })
              .eq('id', job.project_id)
              .eq('org_id', profile.org_id)
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
      linked_to: source_type && source_id ? { type: source_type, id: source_id } : null,
    })

  } catch (error) {
    console.error('Error in POST /api/customers/link:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
