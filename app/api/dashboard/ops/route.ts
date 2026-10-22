import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuthApi } from '@/lib/auth'
import { loadRecentJobCostLines } from '@/lib/job-cost-ledger'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()

    // Get active jobs count
    const { count: activeJobsCount } = await supabase
      .from('production_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', profile.org_id)
      .in('status', ['sold', 'materials', 'scheduled', 'in_progress'])

    // Get open work orders count
    const { count: openWorkOrdersCount } = await supabase
      .from('work_orders')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', profile.org_id)
      // Job crews (trades) are install scheduling, not service work orders.
      .is('trade', null)
      .not('status', 'in', '("completed","cancelled")')

    // Pending materials = active jobs whose material delivery is ordered but not fully in.
    // (This used to count job_product_orders rows with a per-line "ordered" status that nobody
    // updated — 26-0011 and 26-0024 still read "ordered" after being collected. Costs now live in
    // the job cost ledger, which has no per-line order status; delivery is tracked per job.)
    const { count: pendingMaterialsCount, error: pendingMaterialsError } = await supabase
      .from('production_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', profile.org_id)
      .in('status', ['sold', 'materials', 'scheduled', 'in_progress'])
      .in('materials_status', ['ordered', 'partial'])
    if (pendingMaterialsError) throw pendingMaterialsError
    const resolvedPendingMaterialsCount = pendingMaterialsCount || 0

    // Get outstanding payments (sum of remaining balances on active jobs)
    const { data: activeJobs } = await supabase
      .from('production_jobs')
      .select('id, sale_amount')
      .eq('org_id', profile.org_id)
      .in('status', ['sold', 'materials', 'scheduled', 'in_progress', 'complete'])

    let outstandingPayments = 0
    if (activeJobs && activeJobs.length > 0) {
      const jobIds = activeJobs.map(j => j.id)
      
      // Get all payments for these jobs
      const { data: payments } = await supabase
        .from('job_payments')
        .select('job_id, amount_cents')
        .in('job_id', jobIds)

      // Calculate outstanding per job
      const paymentsByJob: Record<string, number> = {}
      payments?.forEach(p => {
        paymentsByJob[p.job_id] = (paymentsByJob[p.job_id] || 0) + (p.amount_cents || 0)
      })

      activeJobs.forEach(job => {
        const saleAmountCents = Math.round((job.sale_amount || 0) * 100)
        const paidCents = paymentsByJob[job.id] || 0
        const remainingCents = saleAmountCents - paidCents
        if (remainingCents > 0) {
          outstandingPayments += remainingCents / 100
        }
      })
    }

    // Get jobs needing attention
    const threeDaysAgo = new Date()
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

    const { data: jobsWithIssues } = await supabase
      .from('production_jobs')
      .select(`
        id,
        job_number,
        address_text,
        sale_amount,
        materials_status,
        materials_ordered_at,
        customer:customers(name),
        assigned_pm:users!production_jobs_assigned_pm_fkey(full_name)
      `)
      .eq('org_id', profile.org_id)
      .in('status', ['sold', 'materials', 'scheduled', 'in_progress'])
      .limit(20)

    // Get work orders for these jobs
    const jobIds = jobsWithIssues?.map(j => j.id) || []
    
    const { data: workOrders } = await supabase
      .from('work_orders')
      .select('job_id, status, due_date')
      .in('job_id', jobIds)
      .not('status', 'in', '("completed","cancelled")')

    // Materials ordered 3+ days ago and still not delivered (job-level delivery status).
    const resolvedOldOrders = (jobsWithIssues || [])
      .filter(
        (job: any) =>
          job.materials_status === 'ordered' &&
          job.materials_ordered_at &&
          new Date(job.materials_ordered_at).getTime() < threeDaysAgo.getTime()
      )
      .map((job: any) => ({ job_id: job.id as string }))

    // Get payments for these jobs
    const { data: jobPayments } = await supabase
      .from('job_payments')
      .select('job_id, amount_cents')
      .in('job_id', jobIds)

    const paymentsByJob: Record<string, number> = {}
    jobPayments?.forEach(p => {
      paymentsByJob[p.job_id] = (paymentsByJob[p.job_id] || 0) + (p.amount_cents || 0)
    })

    const workOrdersByJob: Record<string, any[]> = {}
    workOrders?.forEach(wo => {
      if (!workOrdersByJob[wo.job_id]) workOrdersByJob[wo.job_id] = []
      workOrdersByJob[wo.job_id].push(wo)
    })

    const oldOrdersByJob = new Set(resolvedOldOrders?.map(o => o.job_id) || [])

    const jobsNeedingAttention = (jobsWithIssues || [])
      .map(job => {
        const issues: string[] = []
        const customer = Array.isArray(job.customer) ? job.customer[0] : job.customer
        const pm = Array.isArray(job.assigned_pm) ? job.assigned_pm[0] : job.assigned_pm

        // Check for overdue work orders
        const jobWOs = workOrdersByJob[job.id] || []
        const hasOverdueWO = jobWOs.some(wo => 
          wo.due_date && new Date(wo.due_date) < new Date()
        )
        if (hasOverdueWO) issues.push('Overdue work order')
        else if (jobWOs.length > 0) issues.push('Open work order')

        // Check for old material orders
        if (oldOrdersByJob.has(job.id)) {
          issues.push('Material ordered 3+ days')
        }

        // Check for overdue payments (if job is complete but not fully paid)
        const saleAmountCents = Math.round((job.sale_amount || 0) * 100)
        const paidCents = paymentsByJob[job.id] || 0
        if (saleAmountCents > 0 && paidCents < saleAmountCents * 0.5) {
          issues.push('Payment needed')
        }

        return {
          id: job.id,
          job_number: job.job_number,
          address_text: job.address_text,
          customer_name: customer?.name || 'Unknown',
          assigned_pm: pm?.full_name || null,
          issues,
        }
      })
      .filter(job => job.issues.length > 0)
      .slice(0, 5)

    // Recent material costs from the job cost ledger.
    const formattedRecentOrders = (
      await loadRecentJobCostLines(supabase, profile.org_id, { costType: 'material', limit: 10 })
    ).map((line) => ({
      id: line.id,
      job_id: line.job_id,
      job_number: line.job?.job_number || 'Unknown',
      customer_name: line.job?.customer_name || '',
      description: line.description,
      supplier: null,
      amount: line.amount,
      created_at: line.created_at,
    }))

    // Get open work orders
    const { data: openWOs } = await supabase
      .from('work_orders')
      .select(`
        id,
        job_id,
        work_type,
        assigned_at,
        due_date,
        job:production_jobs(job_number),
        sub:sub_contractors(company_name)
      `)
      .eq('org_id', profile.org_id)
      .not('status', 'in', '("completed","cancelled")')
      .order('assigned_at', { ascending: false })
      .limit(8)

    const formattedWorkOrders = (openWOs || []).map(wo => {
      const job = Array.isArray(wo.job) ? wo.job[0] : wo.job
      const sub = Array.isArray(wo.sub) ? wo.sub[0] : wo.sub
      return {
        id: wo.id,
        job_id: wo.job_id,
        job_number: job?.job_number || 'Unknown',
        sub_name: sub?.company_name || null,
        work_type: wo.work_type || 'Work Order',
        assigned_at: wo.assigned_at,
        is_overdue: wo.due_date ? new Date(wo.due_date) < new Date() : false,
      }
    })

    return NextResponse.json({
      stats: {
        activeJobs: activeJobsCount || 0,
        openWorkOrders: openWorkOrdersCount || 0,
        pendingMaterials: resolvedPendingMaterialsCount,
        outstandingPayments,
      },
      jobsNeedingAttention,
      recentOrders: formattedRecentOrders,
      openWorkOrders: formattedWorkOrders,
    })
  } catch (error: any) {
    console.error('Ops dashboard error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to load dashboard' }, { status: 500 })
  }
}
