import { cache } from 'react'
import { notFound } from 'next/navigation'

import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { callerCanAccessJobBilling } from '@/lib/finance-access'
import { defaultTab, tabsFor, type FileTab } from '@/lib/customer-file/access'
import { buildStages, nextAction, type StageStep } from '@/lib/customer-file/stage'
import { dealRefsFor, getPinned, loadDeal, type ThreadMessage } from '@/lib/threads/get-thread'
import { canOpenDeal } from '@/lib/threads/api'
import { resolveThreadViewer } from '@/lib/threads/viewer'
import type { ThreadViewer } from '@/lib/threads/visibility'

export type FileCustomer = { id: string; name: string | null; phone: string | null; email: string | null; address_text: string | null }
export type FileDealSummary = { id: string; address_text: string | null; status: string | null; created_at: string }
export type FileJob = {
  id: string
  job_number: string | null
  status: string
  project_id: string | null
  sale_amount: number | null
  scheduled_date: string | null
  completed_at: string | null
  payroll_sent_at: string | null
  materials_status: string | null
  materials_eta: string | null
}

export type FileContext = {
  viewer: ThreadViewer
  profile: { id: string; org_id: string; role: string; full_name: string | null; ui_prefs?: Record<string, unknown> | null }
  customer: FileCustomer
  deal: { id: string; owner_user_id: string | null; setter_user_id: string | null; customer_id: string | null; lead_id: string | null; address_text: string | null; status: string | null }
  deals: FileDealSummary[]
  job: FileJob | null
  projectId: string | null
  stages: StageStep[]
  next: { label: string; tab: FileTab } | null
  tabs: FileTab[]
  landing: FileTab
  pinned: ThreadMessage[]
  canViewJobBilling: boolean
  signedContract: boolean
  proposalCount: number
}

/**
 * Everything the file shell needs, once per request (React cache: the layout and the tab page
 * share it). Access is decided here: an unreadable deal is a 404, never a redirect that leaks it exists.
 */
export const loadFile = cache(async (customerId: string, dealId: string): Promise<FileContext> => {
  const { profile } = await requireAuth()
  const admin = createServiceClient()
  const viewer = await resolveThreadViewer(admin, profile)

  const dealRow = await loadDeal(admin, viewer.orgId, dealId)
  if (!dealRow || dealRow.customer_id !== customerId || !canOpenDeal(viewer, dealRow)) notFound()

  const [customerRes, dealsRes, projectRes] = await Promise.all([
    admin.from('customers').select('id, name, phone, email, address_text').eq('id', customerId).eq('org_id', viewer.orgId).maybeSingle(),
    admin.from('opportunities').select('id, address_text, status, created_at, owner_user_id, setter_user_id').eq('customer_id', customerId).eq('org_id', viewer.orgId).order('created_at', { ascending: false }),
    admin.from('projects').select('id').eq('opportunity_id', dealId).eq('org_id', viewer.orgId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (!customerRes.data) notFound()

  const dealRefs = await dealRefsFor(admin, viewer.orgId, ((dealsRes.data ?? []) as Array<{ id: string }>).map((d) => d.id))
  const deals = ((dealsRes.data ?? []) as Array<FileDealSummary & { owner_user_id: string | null; setter_user_id: string | null }>)
    .filter((d) => canOpenDeal(viewer, dealRefs.get(d.id) ?? d))
    .map(({ id, address_text, status, created_at }) => ({ id, address_text, status, created_at }))

  const projectId = (projectRes.data as { id: string } | null)?.id ?? null
  let job: FileJob | null = null
  if (projectId) {
    const { data } = await admin
      .from('production_jobs')
      .select('id, job_number, status, project_id, sale_amount, scheduled_date, completed_at, payroll_sent_at, materials_status, materials_eta')
      .eq('project_id', projectId)
      .eq('org_id', viewer.orgId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    job = (data as FileJob | null) ?? null
  }

  const [proposals, contracts] = await Promise.all([
    admin.from('proposals').select('id', { count: 'exact', head: true }).eq('opportunity_id', dealId).eq('org_id', viewer.orgId),
    admin.from('order_form_contracts').select('id', { count: 'exact', head: true }).eq('opportunity_id', dealId).eq('org_id', viewer.orgId).eq('status', 'completed'),
  ])
  const proposalCount = proposals.count ?? 0
  const signedContract = (contracts.count ?? 0) > 0

  const cancelled = job?.status === 'cancelled'
  const stages = buildStages({
    inspectionSet: true, // a deal exists once an inspection is booked
    hasProposal: proposalCount > 0,
    signed: signedContract,
    job: job
      ? {
          status: job.status,
          scheduled: !!job.scheduled_date,
          completed: !!job.completed_at,
          paid: job.status === 'collected' || !!job.payroll_sent_at,
          payrollSent: !!job.payroll_sent_at,
          cancelled,
        }
      : null,
  })

  const hasJob = !!job
  const prefs = (profile as { ui_prefs?: Record<string, unknown> | null }).ui_prefs ?? null
  const remembered = typeof prefs?.fileTab === 'string' ? (prefs.fileTab as string) : null
  const pinned = await getPinned(admin, viewer, dealRow)

  return {
    viewer,
    profile: { id: profile.id, org_id: profile.org_id, role: profile.role, full_name: profile.full_name ?? null, ui_prefs: prefs },
    customer: customerRes.data as FileCustomer,
    deal: dealRow,
    deals,
    job,
    projectId,
    stages,
    next: nextAction(stages, cancelled),
    tabs: tabsFor(viewer, { hasJob }),
    landing: defaultTab(viewer, { hasJob }, remembered),
    pinned,
    canViewJobBilling: await callerCanAccessJobBilling(admin, profile),
    signedContract,
    proposalCount,
  }
})

/** The deal a customer's file should open on: the active one (job in flight), else the newest. */
export async function pickDefaultDeal(customerId: string): Promise<string | null> {
  const { profile } = await requireAuth()
  const admin = createServiceClient()
  const viewer = await resolveThreadViewer(admin, profile)
  const { data } = await admin
    .from('opportunities')
    .select('id, status, created_at, owner_user_id, setter_user_id')
    .eq('customer_id', customerId)
    .eq('org_id', viewer.orgId)
    .order('created_at', { ascending: false })
  const refs = await dealRefsFor(admin, viewer.orgId, (data ?? []).map((d) => (d as { id: string }).id))
  const readable = (data ?? []).filter((d) => canOpenDeal(viewer, refs.get((d as { id: string }).id) ?? (d as never))) as Array<{ id: string; status: string }>
  if (readable.length === 0) return null
  const active = readable.find((d) => d.status === 'won' || d.status === 'in_progress')
  return (active ?? readable[0]).id
}
