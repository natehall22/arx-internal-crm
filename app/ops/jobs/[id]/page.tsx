export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import JobDetailClient from './JobDetailClient'

interface PageProps {
  params: { id: string }
}

export default async function JobDetailPage({ params }: PageProps) {
  const { profile } = await requireAuth()
  const supabase = createClient()

  const [jobRes, crewsRes, subsRes] = await Promise.all([
    supabase
      .from('production_jobs')
      .select(`
        *,
        assigned_crew:crews(id, name, color, phone),
        assigned_sub:sub_contractors(id, company_name, contact_name, phone),
        customer:customers(id, name, phone, email),
        salesperson:users!production_jobs_salesperson_id_fkey(id, full_name),
        project:projects(id, scope_of_work, product_summary, ops_notes, customers(id, name, phone, email), leads(id, homeowner_name, phone, email))
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

  const transformedJob = {
    ...jobRes.data,
    assigned_crew: Array.isArray(jobRes.data.assigned_crew) ? jobRes.data.assigned_crew[0] : jobRes.data.assigned_crew,
    assigned_sub: Array.isArray(jobRes.data.assigned_sub) ? jobRes.data.assigned_sub[0] : jobRes.data.assigned_sub,
    customer: customer,
    salesperson: Array.isArray(jobRes.data.salesperson) ? jobRes.data.salesperson[0] : jobRes.data.salesperson,
    project: rawProject,
  }

  return (
    <JobDetailClient
      initialJob={transformedJob}
      crews={crewsRes.data || []}
      subs={subsRes.data || []}
      userRole={profile.role}
    />
  )
}
