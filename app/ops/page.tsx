export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import OpsClient from './OpsClient'
import { createServiceClient } from '@/lib/supabase/service'
import { redactProductionJobFinancialSummaryFields, resolveOpsAccess } from '@/lib/ops-access'
import { opsBoardJobsSelectEmbedded } from '@/lib/ops-board-query'
import { enrichOpsJobsWithPayrollSentAt } from '@/lib/ops-payroll-enrich'
import type { OpsBoardJob } from '@/lib/ops-board-types'
import {
  enrichOpsJobsWithMeasureSoldSquaresFallback,
  enrichOpsJobsWithSoldSquares,
} from '@/lib/ops-board-sold-squares'

export default async function OpsPage() {
  const { authUser, profile } = await requireAuth()
  const admin = createServiceClient()
  const ops = await resolveOpsAccess(admin, authUser.id, profile)

  if (!ops.canJobBoard) {
    redirect('/dashboard')
  }

  const supabase = createClient()

  // Load jobs, crews, and subs in parallel
  const [jobsRes, crewsRes, subsRes] = await Promise.all([
    supabase
      .from('production_jobs')
      .select(opsBoardJobsSelectEmbedded())
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

  const rawJobs = (jobsRes.data ?? []) as unknown as Array<{ id: string } & Record<string, unknown>>
  await enrichOpsJobsWithPayrollSentAt(supabase, profile.org_id, rawJobs)
  await enrichOpsJobsWithSoldSquares(supabase, profile.org_id, rawJobs)
  await enrichOpsJobsWithMeasureSoldSquaresFallback(supabase, profile.org_id, rawJobs)
  const jobIds = rawJobs.map((j) => j.id)
  const collectedByJob: Record<string, number> = {}
  if (jobIds.length > 0) {
    const { data: paymentRows } = await supabase
      .from('job_payments')
      .select('job_id, amount_cents')
      .in('job_id', jobIds)
    for (const row of paymentRows || []) {
      collectedByJob[row.job_id] = (collectedByJob[row.job_id] || 0) + row.amount_cents
    }
  }

  // Transform data to handle Supabase's array returns for joins
  const transformedJobs = rawJobs.map((job: any) => {
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
      collected_cents: collectedByJob[job.id] || 0,
      assigned_crew: Array.isArray(job.assigned_crew) ? job.assigned_crew[0] : job.assigned_crew,
      assigned_sub: Array.isArray(job.assigned_sub) ? job.assigned_sub[0] : job.assigned_sub,
      customer: customer,
      salesperson: Array.isArray(job.salesperson) ? job.salesperson[0] : job.salesperson,
      project: rawProject,
    }

    return redactProductionJobFinancialSummaryFields(
      transformed as Record<string, unknown>,
      ops.canViewJobFinancials
    )
  })

  return (
    <OpsClient 
      initialJobs={transformedJobs as unknown as OpsBoardJob[]}
      initialCrews={crewsRes.data || []}
      initialSubs={subsRes.data || []}
      orgId={profile.org_id}
      canViewProfitability={ops.canViewJobFinancials}
    />
  )
}
