export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import JobDetailClient from './JobDetailClient'
import { canAccessJobBilling } from '@/lib/finance-access'

interface PageProps {
  params: { id: string }
}

export default async function JobDetailPage({ params }: PageProps) {
  const { profile } = await requireAuth()
  const supabase = createClient()

  const customRole = profile.custom_role_id
    ? (await supabase
        .from('custom_roles')
        .select('name, display_name')
        .eq('id', profile.custom_role_id)
        .single()).data
    : null

  const canViewJobBilling = canAccessJobBilling({
    role: profile.role,
    customRoleName: customRole?.name,
    customRoleDisplayName: customRole?.display_name,
  })

  const [jobRes, crewsRes, subsRes] = await Promise.all([
    supabase
      .from('production_jobs')
      .select(`
        *,
        assigned_crew:crews(id, name, color, phone),
        assigned_sub:sub_contractors(id, company_name, contact_name, phone),
        customer:customers(id, name, phone, email),
        salesperson:users!production_jobs_salesperson_id_fkey(id, full_name),
        project:projects(id, scope_of_work, product_summary, ops_notes, payment_method, customers(id, name, phone, email), leads(id, homeowner_name, phone, email))
      `)
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single(),
    supabase
      .from('crews')
      .select('id, name, crew_type, color, daily_capacity')
      .eq('org_id', profile.org_id)
      .eq('active', true),
    supabase
      .from('sub_contractors')
      .select('id, company_name, services')
      .eq('org_id', profile.org_id)
      .eq('active', true),
  ])

  if (!jobRes.data) {
    notFound()
  }

  const rawProject = Array.isArray(jobRes.data.project) ? jobRes.data.project[0] : jobRes.data.project
  const rawCustomer = Array.isArray(jobRes.data.customer) ? jobRes.data.customer[0] : jobRes.data.customer
  
  // Try to get customer from: 1) direct customer link, 2) project's customer, 3) project's lead
  let customer = rawCustomer
  if (!customer && rawProject) {
    const projectCustomer = Array.isArray(rawProject.customers) ? rawProject.customers[0] : rawProject.customers
    const projectLead = Array.isArray(rawProject.leads) ? rawProject.leads[0] : rawProject.leads
    
    if (projectCustomer) {
      customer = projectCustomer
    } else if (projectLead) {
      customer = {
        id: projectLead.id,
        name: projectLead.homeowner_name,
        phone: projectLead.phone,
        email: projectLead.email,
      }
    }
  }

  // Find the opportunity_id for this job - needed to find accepted proposals
  let opportunityId: string | null = null
  // Also track the installation agreement PDF URL
  let installationAgreement: { pdf_url: string | null; status: string } | null = null
  
  if (jobRes.data.project_id) {
    // Check order_form_contracts for the opportunity that created this project
    try {
      const { data: contracts } = await supabase
        .from('order_form_contracts')
        .select('opportunity_id, pdf_url, status')
        .eq('status', 'completed')
        .not('opportunity_id', 'is', null)
      
      if (contracts && contracts.length > 0) {
        // Find which contract's opportunity matches this job's address
        for (const contract of contracts) {
          if (contract.opportunity_id) {
            const { data: opp } = await supabase
              .from('opportunities')
              .select('id, address_text')
              .eq('id', contract.opportunity_id)
              .single()
            
            if (opp && opp.address_text === jobRes.data.address_text) {
              opportunityId = opp.id
              // Found the matching contract - store the PDF URL
              installationAgreement = {
                pdf_url: contract.pdf_url,
                status: contract.status
              }
              break
            }
          }
        }
      }
    } catch (e) {
      // order_form_contracts table might not exist
    }
    
    // Fallback: Find opportunity by matching address
    if (!opportunityId && jobRes.data.address_text) {
      const { data: opportunities } = await supabase
        .from('opportunities')
        .select('id')
        .eq('org_id', profile.org_id)
        .eq('address_text', jobRes.data.address_text)
        .limit(1)
      
      if (opportunities && opportunities.length > 0) {
        opportunityId = opportunities[0].id
        
        // Also try to get the installation agreement for this opportunity
        if (!installationAgreement) {
          try {
            const { data: contractData } = await supabase
              .from('order_form_contracts')
              .select('pdf_url, status')
              .eq('opportunity_id', opportunityId)
              .eq('status', 'completed')
              .order('created_at', { ascending: false })
              .limit(1)
            
            if (contractData && contractData.length > 0) {
              installationAgreement = {
                pdf_url: contractData[0].pdf_url,
                status: contractData[0].status
              }
            }
          } catch (e) {
            // Ignore errors
          }
        }
      }
    }
  }

  const transformedJob = {
    ...jobRes.data,
    assigned_crew: Array.isArray(jobRes.data.assigned_crew) ? jobRes.data.assigned_crew[0] : jobRes.data.assigned_crew,
    assigned_sub: Array.isArray(jobRes.data.assigned_sub) ? jobRes.data.assigned_sub[0] : jobRes.data.assigned_sub,
    customer: customer,
    salesperson: Array.isArray(jobRes.data.salesperson) ? jobRes.data.salesperson[0] : jobRes.data.salesperson,
    project: rawProject,
    opportunity_id: opportunityId,
    installation_agreement: installationAgreement,
  }

  return (
    <JobDetailClient
      initialJob={transformedJob}
      crews={crewsRes.data || []}
      subs={subsRes.data || []}
      userRole={profile.role}
      canViewJobBilling={canViewJobBilling}
    />
  )
}
