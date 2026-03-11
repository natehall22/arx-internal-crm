import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

// GET - Get records without customer_id (opportunities, projects, jobs)
export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url)
    const sourceType = searchParams.get('type') || 'all'
    const showAll = searchParams.get('show_all') === 'true'

    const results: {
      opportunities: any[]
      projects: any[]
      jobs: any[]
    } = {
      opportunities: [],
      projects: [],
      jobs: [],
    }

    // Fetch opportunities for linking/customer creation.
    // When show_all=true, include opportunities regardless of current customer linkage.
    if (sourceType === 'all' || sourceType === 'opportunity') {
      let oppQuery = adminClient
        .from('opportunities')
        .select('id, name, status, address_text, contact_name, contact_email, contact_phone, created_at')
        .eq('org_id', profile.org_id)
        .order('created_at', { ascending: false })
        .limit(200)

      if (!showAll) {
        oppQuery = oppQuery.is('customer_id', null)
      }

      if (!showAll) {
        // Filter to relevant stages
        oppQuery = oppQuery.in('status', ['qualified', 'proposal_sent', 'won', 'project_created', 'closed_won'])
      }

      const { data: opps } = await oppQuery
      results.opportunities = (opps || []).map(o => ({
        ...o,
        source_type: 'opportunity',
        display_name: o.name || o.contact_name || o.address_text || 'Unnamed Opportunity',
        customer_name: o.contact_name,
        customer_email: o.contact_email,
        customer_phone: o.contact_phone,
        customer_address: o.address_text,
      }))
    }

    // Fetch projects without customer_id
    if (sourceType === 'all' || sourceType === 'project') {
      const { data: projects } = await adminClient
        .from('projects')
        .select(`
          id, status, address_text, created_at,
          lead:leads(homeowner_name, email, phone)
        `)
        .eq('org_id', profile.org_id)
        .is('customer_id', null)
        .order('created_at', { ascending: false })
        .limit(50)

      // For each project, also try to get proposal customer info
      const projectsWithProposals = await Promise.all((projects || []).map(async (p) => {
        const lead = Array.isArray(p.lead) ? p.lead[0] : p.lead
        
        // Try to get customer info from proposal
        const { data: proposal } = await adminClient
          .from('proposals')
          .select('customer_name, customer_email, customer_phone, customer_address')
          .eq('project_id', p.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        const customerName = proposal?.customer_name || lead?.homeowner_name
        const customerEmail = proposal?.customer_email || lead?.email
        const customerPhone = proposal?.customer_phone || lead?.phone
        const customerAddress = proposal?.customer_address || p.address_text

        return {
          ...p,
          source_type: 'project',
          display_name: customerName || p.address_text || 'Unnamed Project',
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone,
          customer_address: customerAddress,
        }
      }))

      results.projects = projectsWithProposals
    }

    // Fetch production_jobs without customer_id
    if (sourceType === 'all' || sourceType === 'job') {
      const { data: jobs } = await adminClient
        .from('production_jobs')
        .select(`
          id, job_number, status, address_text, created_at, project_id,
          project:projects(
            lead:leads(homeowner_name, email, phone)
          )
        `)
        .eq('org_id', profile.org_id)
        .is('customer_id', null)
        .order('created_at', { ascending: false })
        .limit(50)

      // For each job, also try to get proposal customer info
      const jobsWithProposals = await Promise.all((jobs || []).map(async (j) => {
        const project = Array.isArray(j.project) ? j.project[0] : j.project
        const lead = project?.lead ? (Array.isArray(project.lead) ? project.lead[0] : project.lead) : null
        
        let customerName = lead?.homeowner_name
        let customerEmail = lead?.email
        let customerPhone = lead?.phone
        let customerAddress = j.address_text

        // Try to get customer info from proposal
        if (j.project_id) {
          const { data: proposal } = await adminClient
            .from('proposals')
            .select('customer_name, customer_email, customer_phone, customer_address')
            .eq('project_id', j.project_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()

          if (proposal?.customer_name) {
            customerName = proposal.customer_name
            customerEmail = proposal.customer_email || customerEmail
            customerPhone = proposal.customer_phone || customerPhone
            customerAddress = proposal.customer_address || customerAddress
          }
        }

        return {
          ...j,
          source_type: 'job',
          display_name: `Job ${j.job_number}` + (j.address_text ? ` - ${j.address_text}` : ''),
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone,
          customer_address: customerAddress,
        }
      }))

      results.jobs = jobsWithProposals
    }

    return NextResponse.json(results)

  } catch (error) {
    console.error('Error in GET /api/customers/sources:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
