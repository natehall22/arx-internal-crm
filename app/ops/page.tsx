export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import OpsClient from './OpsClient'

function sanitizeJobForRole(job: any, role: string) {
  const isAdmin = role === 'admin'
  if (isAdmin) return job

  // Do not expose direct cost fields to non-admin roles on the job board payload.
  const { labor_cost, material_cost, ...safeJob } = job
  return safeJob
}

export default async function OpsPage() {
  const { profile } = await requireAuth()
  
  // Check role access
  if (!['admin', 'regional_manager', 'operations', 'manager', 'owner'].includes(profile.role)) {
    redirect('/dashboard')
  }

  const supabase = createClient()

  // Load jobs, crews, and subs in parallel
  const [jobsRes, crewsRes, subsRes] = await Promise.all([
    supabase
      .from('production_jobs')
      .select(`
        *,
        assigned_crew:crews(id, name, color),
        assigned_sub:sub_contractors(id, company_name),
        customer:customers(id, name, phone),
        salesperson:users!production_jobs_salesperson_id_fkey(id, full_name),
        project:projects(id, scope_of_work, product_summary, ops_notes, permits_status, install_date, project_review, customers(id, name, phone), leads(id, homeowner_name, phone))
      `)
      .eq('org_id', profile.org_id)
      .order('scheduled_date', { ascending: true, nullsFirst: false }),
    supabase
      .from('crews')
      .select('id, name, crew_type, color, daily_capacity')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .order('name'),
    supabase
      .from('sub_contractors')
      .select('id, company_name, services')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .order('company_name'),
  ])

  // Transform data to handle Supabase's array returns for joins
  const transformedJobs = (jobsRes.data || []).map((job: any) => {
    const rawProject = Array.isArray(job.project) ? job.project[0] : job.project
    const rawCustomer = Array.isArray(job.customer) ? job.customer[0] : job.customer
    
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
        }
      }
    }

    const transformed = {
      ...job,
      assigned_crew: Array.isArray(job.assigned_crew) ? job.assigned_crew[0] : job.assigned_crew,
      assigned_sub: Array.isArray(job.assigned_sub) ? job.assigned_sub[0] : job.assigned_sub,
      customer: customer,
      salesperson: Array.isArray(job.salesperson) ? job.salesperson[0] : job.salesperson,
      project: rawProject,
    }

    return sanitizeJobForRole(transformed, profile.role)
  })

  return (
    <OpsClient 
      initialJobs={transformedJobs}
      initialCrews={crewsRes.data || []}
      initialSubs={subsRes.data || []}
      orgId={profile.org_id}
      canViewProfitability={profile.role === 'admin'}
    />
  )
}
