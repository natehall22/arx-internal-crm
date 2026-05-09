export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import SendToOpsButton from '@/components/SendToOpsButton'
import DeleteProjectButton from '@/components/DeleteProjectButton'
import ProjectFinancialSnapshot from '@/components/ProjectFinancialSnapshot'
import LinkCustomerButton from '@/components/customers/LinkCustomerButton'
import ProjectFileUpload from '@/components/ProjectFileUpload'
import ProjectSoldScope from '@/components/ProjectSoldScope'
import JobNotesReadOnly from '@/components/JobNotesReadOnly'
import ChangeOrdersSection from '@/components/change-orders/ChangeOrdersSection'
import ProjectReviewButton from '@/components/projects/ProjectReviewButton'
import ProjectAddressEdit from '@/components/projects/ProjectAddressEdit'
import { parseProjectReviewStored } from '@/lib/project-review'
import { canAccessJobBoard } from '@/lib/permissions'
import { canAccessJobBilling } from '@/lib/finance-access'
import PayrollAttributionEditor, {
  type PayrollAttributionData,
} from '@/components/payroll/PayrollAttributionEditor'

/** Label for list/detail — matches `mapJobStatusToProjectStatus` on projects list (job is source of truth). */
function jobStatusLabel(jobStatus: string | null | undefined): string {
  if (!jobStatus) return ''
  if (jobStatus === 'collected') return 'Collected'
  if (jobStatus === 'complete') return 'Complete'
  if (jobStatus === 'on_hold') return 'On hold'
  return 'In progress'
}

export default async function ProjectDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const { profile } = await requireAuth()
  const showOpsJobLinks = canAccessJobBoard(profile.role)
  const supabase = createServiceClient()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  const salesRoleRestricted = ['rep', 'sales_rep', 'closer'].includes(profile.role)
  let oppIdsOwnedByMe: string[] = []
  if (salesRoleRestricted) {
    const { data: myOpps } = await supabase
      .from('opportunities')
      .select('id')
      .eq('org_id', profile.org_id)
      .eq('owner_user_id', profile.id)
    oppIdsOwnedByMe = (myOpps || []).map((o) => o.id).filter(Boolean)
  }

  let projectQuery = supabase
    .from('projects')
    .select('*, customers(*), leads(*)')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)

  // Match /projects list: reps/closers see rows they own or where they own the linked opportunity
  if (salesRoleRestricted) {
    if (oppIdsOwnedByMe.length > 0) {
      projectQuery = projectQuery.or(
        `owner_user_id.eq.${profile.id},opportunity_id.in.(${oppIdsOwnedByMe.join(',')})`
      )
    } else {
      projectQuery = projectQuery.eq('owner_user_id', profile.id)
    }
  }

  const { data: project } = await projectQuery.single()

  if (!project) {
    notFound()
  }

  const { data: activities } = await supabase
    .from('activities')
    .select('*, users(full_name)')
    .eq('project_id', params.id)
    .order('created_at', { ascending: false })

  const { data: files } = await supabase
    .from('files')
    .select('*')
    .eq('project_id', params.id)
    .order('created_at', { ascending: false })

  const { data: estimates } = await supabase
    .from('estimates')
    .select('*')
    .eq('project_id', params.id)
    .order('created_at', { ascending: false })

  // Check if production job exists for this project
  const { data: productionJob } = await supabase
    .from('production_jobs')
    .select('id, job_number, sale_amount, status')
    .eq('project_id', params.id)
    .single()

  // Fetch signed sale agreement PDF from order_form_contracts
  // Try multiple methods to find the contract
  let installationAgreement: { pdf_url: string | null; status: string; agreement_type?: string | null } | null = null
  
  try {
    // Method 1: Find contract by matching project address to contract project_address
      const { data: contractsByAddress } = await supabase
        .from('order_form_contracts')
        .select('pdf_url, status, agreement_type')
        .eq('org_id', profile.org_id)
        .eq('project_address', project.address_text)
        .eq('status', 'completed')
        .in('agreement_type', ['installation', 'repair'])
        .order('created_at', { ascending: false })
        .limit(1)
    
    if (contractsByAddress && contractsByAddress.length > 0) {
      installationAgreement = {
        pdf_url: contractsByAddress[0].pdf_url,
        status: contractsByAddress[0].status,
        agreement_type: contractsByAddress[0].agreement_type,
      }
    }
    
    // Method 2: If not found, try to find via opportunity
    if (!installationAgreement) {
      const { data: opportunities } = await supabase
        .from('opportunities')
        .select('id')
        .eq('org_id', profile.org_id)
        .eq('address_text', project.address_text)
        .limit(1)
      
      if (opportunities && opportunities.length > 0) {
        const opportunityId = opportunities[0].id
        
        const { data: contracts } = await supabase
          .from('order_form_contracts')
          .select('pdf_url, status, agreement_type')
          .eq('opportunity_id', opportunityId)
          .eq('status', 'completed')
          .in('agreement_type', ['installation', 'repair'])
          .order('created_at', { ascending: false })
          .limit(1)
        
        if (contracts && contracts.length > 0) {
          installationAgreement = {
            pdf_url: contracts[0].pdf_url,
            status: contracts[0].status,
            agreement_type: contracts[0].agreement_type,
          }
        }
      }
    }
  } catch (e) {
    // order_form_contracts table might not exist yet
    console.log('Could not fetch installation agreement:', e)
  }

  // Fetch original sale agreement details for change orders
  let originalContract: {
    id: string
    project_cost: number
    created_at: string
    payment_method: string | null
  } | null = null

  try {
    // Try to find completed contract by address first
    const { data: contractByAddress } = await supabase
      .from('order_form_contracts')
      .select('id, project_cost, created_at, payment_method')
      .eq('org_id', profile.org_id)
      .eq('project_address', project.address_text)
      .eq('status', 'completed')
      .in('agreement_type', ['installation', 'repair'])
      .order('created_at', { ascending: false })
      .limit(1)

    if (contractByAddress && contractByAddress.length > 0) {
      originalContract = contractByAddress[0]
    }

    // Fallback: find via opportunity
    if (!originalContract) {
      const { data: opportunities } = await supabase
        .from('opportunities')
        .select('id')
        .eq('org_id', profile.org_id)
        .eq('address_text', project.address_text)
        .limit(1)

      if (opportunities && opportunities.length > 0) {
        const { data: contractByOpp } = await supabase
          .from('order_form_contracts')
          .select('id, project_cost, created_at, payment_method')
          .eq('opportunity_id', opportunities[0].id)
          .eq('status', 'completed')
          .in('agreement_type', ['installation', 'repair'])
          .order('created_at', { ascending: false })
          .limit(1)

        if (contractByOpp && contractByOpp.length > 0) {
          originalContract = contractByOpp[0]
        }
      }
    }
  } catch (e) {
    console.log('Could not fetch original contract:', e)
  }

  // Fetch change orders for this project
  let changeOrders: any[] = []
  try {
    const { data: coData } = await supabase
      .from('job_change_orders')
      .select('id, co_number, signed_at, updated_total, pdf_url, status, signing_token, customer_signed_at')
      .eq('project_id', params.id)
      .order('created_at', { ascending: true })

    if (coData) {
      changeOrders = coData
    }
  } catch (e) {
    console.log('Could not fetch change orders:', e)
  }

  // Calculate amount already collected from job payments
  let amountCollected = 0
  if (productionJob?.id) {
    try {
      const { data: payments } = await supabase
        .from('job_payments')
        .select('amount_cents')
        .eq('job_id', productionJob.id)

      if (payments) {
        amountCollected = payments.reduce((sum, p) => sum + (p.amount_cents || 0), 0) / 100
      }
    } catch (e) {
      console.log('Could not fetch payments:', e)
    }
  }

  // Get customer name for change orders
  const customerName = project.customers?.name || project.leads?.homeowner_name || 'Customer'
  const customerEmail = project.customers?.email || project.leads?.email || null

  const canViewJobBilling = canAccessJobBilling({ role: profile.role })
  const canEditPayrollAttribution = ['admin', 'owner', 'operations'].includes(profile.role)

  let payrollAttribution: PayrollAttributionData | null = null
  const linkedOpportunityId = project.opportunity_id as string | null | undefined
  if (linkedOpportunityId) {
    const { data: oppRow } = await supabase
      .from('opportunities')
      .select('setter_user_id, owner_user_id')
      .eq('id', linkedOpportunityId)
      .eq('org_id', profile.org_id)
      .maybeSingle()

    if (oppRow) {
      const setterId = oppRow.setter_user_id ?? null
      const closerId = oppRow.owner_user_id ?? null
      const ids = [setterId, closerId].filter((x): x is string => typeof x === 'string')
      const nameById = new Map<string, string>()
      if (ids.length > 0) {
        const { data: nameRows } = await supabase
          .from('users')
          .select('id, full_name')
          .eq('org_id', profile.org_id)
          .in('id', ids)
        for (const u of nameRows || []) {
          nameById.set(u.id, u.full_name || u.id)
        }
      }
      payrollAttribution = {
        opportunity_id: linkedOpportunityId,
        setter_user_id: setterId,
        closer_user_id: closerId,
        setter_name: setterId ? nameById.get(setterId) ?? null : null,
        closer_name: closerId ? nameById.get(closerId) ?? null : null,
      }
    }
  }

  const showPayrollAttribution =
    payrollAttribution && (canViewJobBilling || canEditPayrollAttribution)

  const projectReviewStored = parseProjectReviewStored(
    (project as { project_review?: unknown }).project_review
  )

  // Get the current contract total (latest change order or original)
  const currentContractTotal = changeOrders.length > 0
    ? changeOrders[changeOrders.length - 1].updated_total
    : (originalContract?.project_cost || productionJob?.sale_amount || 0)

  const suggestedSendToOpsSale =
    currentContractTotal != null && Number(currentContractTotal) > 0
      ? Number(currentContractTotal)
      : null
  const agreementLabel =
    installationAgreement?.agreement_type === 'repair' ? 'Repair Agreement' : 'Installation Agreement'

  const updateAddress = async (formData: FormData) => {
    'use server'
    const { profile } = await requireAuth()
    const supabase = createServiceClient()

    if (!['admin', 'operations', 'regional_manager'].includes(profile.role)) {
      return
    }

    const address = String(formData.get('address') ?? '').trim()
    if (!address) return

    await supabase
      .from('projects')
      .update({ address_text: address })
      .eq('id', params.id)
      .eq('org_id', profile.org_id)

    await supabase.from('activities').insert({
      org_id: profile.org_id,
      project_id: params.id,
      user_id: profile.id,
      type: 'note',
      body: 'Project job site address updated.',
    })

    revalidatePath(`/projects/${params.id}`)
  }

  const canEditProjectAddress = ['admin', 'operations', 'regional_manager'].includes(profile.role)

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Link
            href="/projects"
            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
          >
            ← Back to Projects
          </Link>
        </div>

        <ProjectFinancialSnapshot
          projectId={project.id}
          jobId={productionJob?.id || null}
          jobNumber={productionJob?.job_number || null}
          contractTotal={productionJob?.sale_amount || null}
          showJobDetailLink={showOpsJobLinks}
        />

        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <div className="flex justify-between items-start mb-4">
            <h1 className="text-2xl font-bold text-gray-900">Project Details</h1>
            <div className="flex items-center gap-3 flex-wrap justify-end">
              {['admin', 'regional_manager', 'operations', 'manager', 'sales_manager'].includes(profile.role) && (
                <SendToOpsButton 
                  projectId={project.id}
                  existingJobId={productionJob?.id}
                  existingJobNumber={productionJob?.job_number}
                  canOpenOpsJobDetail={showOpsJobLinks}
                  defaultSaleAmount={suggestedSendToOpsSale}
                />
              )}
              <ProjectReviewButton
                key={projectReviewStored?.submittedAt ?? 'none'}
                projectId={project.id}
                jobId={productionJob?.id ?? null}
                initialReview={projectReviewStored}
              />
              <Link
                href={`/estimates/new?project_id=${project.id}`}
                className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 text-sm"
              >
                Create Estimate
              </Link>
              {profile.role === 'admin' && (
                <DeleteProjectButton 
                  projectId={project.id}
                  address={project.address_text}
                />
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-medium text-gray-500">Customer</h3>
              <div className="mt-1">
                {!project.customer_id && project.leads?.homeowner_name && (
                  <p className="text-sm text-gray-900 mb-1">
                    {project.leads.homeowner_name}
                  </p>
                )}
                <LinkCustomerButton 
                  sourceType="project" 
                  sourceId={project.id} 
                  currentCustomerId={project.customer_id}
                  currentCustomerName={project.customers?.name}
                />
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500">Status</h3>
              <p className="mt-1 text-sm text-gray-900 capitalize">
                {productionJob?.status
                  ? jobStatusLabel(productionJob.status)
                  : String(project.status || 'open').replace('_', ' ')}
              </p>
              {productionJob?.id ? (
                <p className="mt-1 text-xs text-gray-500">
                  {showOpsJobLinks ? (
                    <>
                      Set on the{' '}
                      <Link
                        href={`/ops/jobs/${productionJob.id}`}
                        className="text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        Job Board
                      </Link>
                      .
                    </>
                  ) : (
                    <>Production status follows the linked job (Job Board).</>
                  )}
                </p>
              ) : (
                <p className="mt-1 text-xs text-gray-500">Updates when a job is created from this project (Send to Ops).</p>
              )}
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500">Project Type</h3>
              <p className="mt-1 text-sm text-gray-900 capitalize">{project.project_type}</p>
            </div>
            <div className="md:col-span-2">
              <h3 className="text-sm font-medium text-gray-500">Address</h3>
              {canEditProjectAddress ? (
                <ProjectAddressEdit
                  currentAddress={project.address_text}
                  updateAddressAction={updateAddress}
                />
              ) : (
                <>
                  <p className="mt-1 text-sm text-gray-900">{project.address_text || 'N/A'}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Job site address stored on the project (from proposal/lead when created). Ask an admin or
                    ops to correct it if needed.
                  </p>
                </>
              )}
            </div>
            {project.roof_squares && (
              <div>
                <h3 className="text-sm font-medium text-gray-500">Roof Squares</h3>
                <p className="mt-1 text-sm text-gray-900">{project.roof_squares}</p>
              </div>
            )}
            {project.siding_squares && (
              <div>
                <h3 className="text-sm font-medium text-gray-500">Siding Squares</h3>
                <p className="mt-1 text-sm text-gray-900">{project.siding_squares}</p>
              </div>
            )}
            {project.vents_count > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-500">Vents Count</h3>
                <p className="mt-1 text-sm text-gray-900">{project.vents_count}</p>
              </div>
            )}
            {project.layers > 1 && (
              <div>
                <h3 className="text-sm font-medium text-gray-500">Layers</h3>
                <p className="mt-1 text-sm text-gray-900">{project.layers}</p>
              </div>
            )}
            {project.total_windows > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-500">Total Windows</h3>
                <p className="mt-1 text-sm text-gray-900">{project.total_windows}</p>
              </div>
            )}
            {project.windows_by_type && (
              <div className="md:col-span-2">
                <h3 className="text-sm font-medium text-gray-500">Windows by Type</h3>
                <pre className="mt-1 text-sm text-gray-900">
                  {JSON.stringify(project.windows_by_type, null, 2)}
                </pre>
              </div>
            )}
            {project.notes && (
              <div className="md:col-span-2">
                <h3 className="text-sm font-medium text-gray-500">Notes</h3>
                <p className="mt-1 text-sm text-gray-900 whitespace-pre-wrap">{project.notes}</p>
              </div>
            )}
          </div>
        </div>

        {showPayrollAttribution && payrollAttribution && (
          <div className="mb-6">
            <PayrollAttributionEditor
              opportunityId={payrollAttribution.opportunity_id}
              initial={payrollAttribution}
              canEdit={canEditPayrollAttribution}
            />
          </div>
        )}

        {/* Sale agreement - from order_form_contracts */}
        {installationAgreement && (
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">{agreementLabel}</h2>
              {installationAgreement.pdf_url ? (
                <a
                  href={installationAgreement.pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  View {agreementLabel}
                </a>
              ) : (
                <span className="text-sm text-gray-500 flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  PDF generating...
                </span>
              )}
            </div>
          </div>
        )}

        {/* Change Orders Section */}
        {(originalContract || productionJob?.sale_amount) && (
          <ChangeOrdersSection
            projectId={params.id}
            projectAddress={project.address_text || ''}
            customerName={customerName}
            customerEmail={customerEmail}
            originalContractAmount={currentContractTotal}
            originalContractDate={originalContract?.created_at?.split('T')[0] || null}
            originalContractId={originalContract?.id || null}
            paymentMethod={originalContract?.payment_method || null}
            amountCollected={amountCollected}
            jobId={productionJob?.id || null}
            repName={profile.full_name || ''}
            changeOrders={changeOrders}
          />
        )}

        {estimates && estimates.length > 0 && (
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Estimates</h2>
            <div className="space-y-2">
              {estimates.map((estimate: any) => (
                <div key={estimate.id} className="flex items-center justify-between p-3 border rounded">
                  <div>
                    <span className="text-sm font-medium text-gray-900 capitalize">
                      {estimate.status}
                    </span>
                    <span className="text-sm text-gray-500 ml-4">
                      ${estimate.total.toFixed(2)}
                    </span>
                  </div>
                  <Link
                    href={`/estimates/${estimate.id}`}
                    className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                  >
                    View →
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* What Was Sold - Accepted Proposal Summary */}
        <ProjectSoldScope projectId={project.id} />

        {/* Job Notes - Read Only from associated production job */}
        {productionJob && (
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">Job Notes</h2>
              {showOpsJobLinks ? (
                <Link
                  href={`/ops/jobs/${productionJob.id}`}
                  className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                >
                  View Job →
                </Link>
              ) : null}
            </div>
            <JobNotesReadOnly jobId={productionJob.id} limit={10} />
          </div>
        )}

        {/* Operations Snapshot - Read Only (edit on Job Detail page) */}
        {(project.scope_of_work || project.product_summary || project.permits_status || project.install_date || project.ops_notes) && (
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900">Operations Snapshot</h2>
              {productionJob && showOpsJobLinks ? (
                <Link
                  href={`/ops/jobs/${productionJob.id}`}
                  className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                >
                  Edit on Job →
                </Link>
              ) : null}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              {project.scope_of_work && (
                <div className="md:col-span-2">
                  <span className="font-medium text-gray-500">Scope of Work</span>
                  <p className="mt-1 text-gray-900 whitespace-pre-wrap">{project.scope_of_work}</p>
                </div>
              )}
              {project.product_summary && (
                <div>
                  <span className="font-medium text-gray-500">Product</span>
                  <p className="mt-1 text-gray-900">{project.product_summary}</p>
                </div>
              )}
              {project.permits_status && (
                <div>
                  <span className="font-medium text-gray-500">Permits</span>
                  <p className="mt-1 text-gray-900">{project.permits_status}</p>
                </div>
              )}
              {project.install_date && (
                <div>
                  <span className="font-medium text-gray-500">Install Date</span>
                  <p className="mt-1 text-gray-900">{new Date(project.install_date).toLocaleDateString()}</p>
                </div>
              )}
              {project.ops_notes && (
                <div className="md:col-span-2">
                  <span className="font-medium text-gray-500">Ops Notes</span>
                  <p className="mt-1 text-gray-900 whitespace-pre-wrap">{project.ops_notes}</p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Activities</h2>
            <div className="space-y-4">
              {activities && activities.length > 0 ? (
                activities.map((activity: any) => (
                  <div key={activity.id} className="border-b border-gray-200 pb-3">
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-900">
                        {activity.users?.full_name || 'Unknown'}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(activity.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1 capitalize">
                      {activity.type.replace('_', ' ')}
                    </p>
                    <p className="text-sm text-gray-800 mt-1">{activity.body}</p>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 text-sm">No activities</p>
              )}
            </div>
          </div>

          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Files & Photos</h2>
            <ProjectFileUpload projectId={project.id} />
            <div className="space-y-2 mt-4">
              {files && files.length > 0 ? (
                files.map((file: any) => {
                  const fileUrl = `${supabaseUrl}/storage/v1/object/public/files/${file.storage_path}`
                  return (
                    <div key={file.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center">
                          {file.mime_type?.startsWith('image/') ? (
                            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{file.file_name}</p>
                          <p className="text-xs text-gray-500 capitalize">{file.tag}</p>
                        </div>
                      </div>
                      <a
                        href={fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-600 hover:text-indigo-800 text-sm font-medium flex items-center gap-1"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download
                      </a>
                    </div>
                  )
                })
              ) : (
                <p className="text-gray-500 text-sm">No files</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
