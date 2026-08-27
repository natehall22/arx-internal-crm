import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { canAccessCustomerRecordsFromPermissionNames, isRepLikeCustomerRecordRole } from '@/lib/permissions'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'

export const dynamic = 'force-dynamic'

// GET - Get records without customer_id (opportunities, projects, jobs)
export async function GET(request: Request) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    const customerPermissions = await resolveEffectivePermissionNames(adminClient, profile.id, profile)
    if (!canAccessCustomerRecordsFromPermissionNames(customerPermissions)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const repScoped = isRepLikeCustomerRecordRole(profile.role)

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
        .select('id, lead_id, name, status, address_text, contact_name, contact_email, contact_phone, created_at')
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

      if (repScoped) {
        oppQuery = oppQuery.eq('owner_user_id', profile.id)
      }

      const { data: opps, error: oppError } = await oppQuery
      if (oppError) {
        console.error('Error fetching opportunities for customer source modal:', oppError)
      }

      const leadIds = Array.from(
        new Set((opps || []).map((o: any) => o.lead_id).filter(Boolean))
      ) as string[]

      let leadsById: Record<string, any> = {}
      if (leadIds.length > 0) {
        const { data: leads, error: leadsError } = await adminClient
          .from('leads')
          .select('id, homeowner_name, email, phone')
          .in('id', leadIds)
          .eq('org_id', profile.org_id)

        if (leadsError) {
          console.error('Error fetching lead details for customer source modal:', leadsError)
        } else {
          leadsById = Object.fromEntries((leads || []).map((lead: any) => [lead.id, lead]))
        }
      }

      results.opportunities = (opps || []).map((o: any) => {
        const lead = o.lead_id ? leadsById[o.lead_id] : null
        const customerName = o.contact_name || lead?.homeowner_name
        const customerEmail = o.contact_email || lead?.email
        const customerPhone = o.contact_phone || lead?.phone
        return {
        ...o,
        source_type: 'opportunity',
        display_name: o.name || customerName || o.address_text || 'Unnamed Opportunity',
        customer_name: customerName,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        customer_address: o.address_text,
        }
      })
    }

    // Fetch projects for linking: default = no customer; show_all = include linked (to fix bad links)
    if (sourceType === 'all' || sourceType === 'project') {
      let projectQuery = adminClient
        .from('projects')
        .select(`
          id, status, address_text, created_at, customer_id, owner_user_id,
          lead:leads(homeowner_name, email, phone),
          customers(name)
        `)
        .eq('org_id', profile.org_id)
        .order('created_at', { ascending: false })

      if (!showAll) {
        projectQuery = projectQuery.is('customer_id', null).limit(50)
      } else {
        projectQuery = projectQuery.limit(200)
      }

      if (repScoped) {
        projectQuery = projectQuery.eq('owner_user_id', profile.id)
      }

      const { data: projects } = await projectQuery

      // For each project, also try to get proposal customer info
      const projectsWithProposals = await Promise.all((projects || []).map(async (p: any) => {
        const lead = Array.isArray(p.lead) ? p.lead[0] : p.lead
        const linkedRow = Array.isArray(p.customers) ? p.customers[0] : p.customers
        const linkedCustomerName = linkedRow?.name as string | undefined

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
          linked_customer_name: p.customer_id ? linkedCustomerName : null,
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
            owner_user_id,
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

      results.jobs = repScoped
        ? jobsWithProposals.filter((j) => {
            const project = Array.isArray(j.project) ? j.project[0] : j.project
            return project?.owner_user_id === profile.id
          })
        : jobsWithProposals
    }

    return NextResponse.json(results)

  } catch (error) {
    console.error('Error in GET /api/customers/sources:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
