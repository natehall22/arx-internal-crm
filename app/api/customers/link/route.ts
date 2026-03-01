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
          .select('address_text, lead:leads(homeowner_name, email, phone)')
          .eq('id', source_id)
          .eq('org_id', profile.org_id)
          .single()
        
        if (data) {
          const lead = Array.isArray(data.lead) ? data.lead[0] : data.lead
          sourceData = {
            name: lead?.homeowner_name,
            email: lead?.email,
            phone: lead?.phone,
            address_text: data.address_text,
          }
        }
      } else if (source_type === 'job') {
        const { data } = await adminClient
          .from('production_jobs')
          .select('address_text, project:projects(lead:leads(homeowner_name, email, phone))')
          .eq('id', source_id)
          .eq('org_id', profile.org_id)
          .single()
        
        if (data) {
          const project = Array.isArray(data.project) ? data.project[0] : data.project
          const lead = project?.lead ? (Array.isArray(project.lead) ? project.lead[0] : project.lead) : null
          sourceData = {
            name: lead?.homeowner_name,
            email: lead?.email,
            phone: lead?.phone,
            address_text: data.address_text,
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
