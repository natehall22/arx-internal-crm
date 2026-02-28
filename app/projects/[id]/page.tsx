export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import ReferralsSection from '@/components/ReferralsSection'
import SendToOpsButton from '@/components/SendToOpsButton'
import ProjectStatusUpdate from '@/components/ProjectStatusUpdate'

export default async function ProjectDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const { profile } = await requireAuth()
  const supabase = createClient()

  let projectQuery = supabase
    .from('projects')
    .select('*, customers(*), leads(*)')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)

  if (profile.role === 'rep') {
    projectQuery = projectQuery.eq('owner_user_id', profile.id)
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

  // Fetch work orders for this project
  const { data: workOrders } = await supabase
    .from('work_orders')
    .select('*, assigned_user:users!work_orders_assigned_user_id_fkey(full_name), assigned_sub:sub_contractors(company_name)')
    .eq('project_id', params.id)
    .order('created_at', { ascending: false })

  // Check if production job exists for this project
  const { data: productionJob } = await supabase
    .from('production_jobs')
    .select('id, job_number')
    .eq('project_id', params.id)
    .single()

  const updateOps = async (formData: FormData) => {
    'use server'
    const { profile } = await requireAuth()
    const supabase = createClient()

    const scope_of_work = String(formData.get('scope_of_work') ?? '')
    const permits_status = String(formData.get('permits_status') ?? '')
    const product_summary = String(formData.get('product_summary') ?? '')
    const install_date = String(formData.get('install_date') ?? '')
    const ops_notes = String(formData.get('ops_notes') ?? '')

    let opsQuery = supabase
      .from('projects')
      .update({
        scope_of_work: scope_of_work || null,
        permits_status: permits_status || null,
        product_summary: product_summary || null,
        install_date: install_date || null,
        ops_notes: ops_notes || null,
      })
      .eq('id', params.id)
      .eq('org_id', profile.org_id)

    if (profile.role === 'rep') {
      opsQuery = opsQuery.eq('owner_user_id', profile.id)
    }

    await opsQuery

    revalidatePath(`/projects/${params.id}`)
  }

  const updateStatus = async (formData: FormData) => {
    'use server'
    const { profile } = await requireAuth()
    const supabase = createClient()

    const newStatus = String(formData.get('status') ?? '')
    if (!newStatus) return

    // Only allow operations and admin to update status
    if (!['admin', 'operations', 'regional_manager'].includes(profile.role)) {
      return
    }

    await supabase
      .from('projects')
      .update({ status: newStatus })
      .eq('id', params.id)
      .eq('org_id', profile.org_id)

    await supabase.from('activities').insert({
      org_id: profile.org_id,
      project_id: params.id,
      user_id: profile.id,
      type: 'status_change',
      body: `Project status updated to ${newStatus.replace('_', ' ')}.`,
    })

    revalidatePath(`/projects/${params.id}`)
  }

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

        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <div className="flex justify-between items-start mb-4">
            <h1 className="text-2xl font-bold text-gray-900">Project Details</h1>
            <div className="flex items-center gap-3">
              {['admin', 'regional_manager', 'operations', 'manager', 'sales_manager'].includes(profile.role) && (
                <SendToOpsButton 
                  projectId={project.id}
                  existingJobId={productionJob?.id}
                  existingJobNumber={productionJob?.job_number}
                />
              )}
              <Link
                href={`/estimates/new?project_id=${project.id}`}
                className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 text-sm"
              >
                Create Estimate
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-medium text-gray-500">Customer</h3>
              {project.customer_id ? (
                <Link
                  href={`/customers/${project.customer_id}`}
                  className="mt-1 inline-block text-sm font-semibold text-indigo-600 hover:text-indigo-800"
                >
                  {project.customers?.name || 'View customer'}
                </Link>
              ) : (
                <p className="mt-1 text-sm text-gray-900">
                  {project.customers?.name || project.leads?.homeowner_name || 'N/A'}
                </p>
              )}
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500">Status</h3>
              {['admin', 'operations', 'regional_manager'].includes(profile.role) ? (
                <ProjectStatusUpdate
                  projectId={params.id}
                  currentStatus={project.status}
                  updateStatusAction={updateStatus}
                />
              ) : (
                <p className="mt-1 text-sm text-gray-900 capitalize">
                  {project.status.replace('_', ' ')}
                </p>
              )}
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500">Project Type</h3>
              <p className="mt-1 text-sm text-gray-900 capitalize">{project.project_type}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500">Address</h3>
              <p className="mt-1 text-sm text-gray-900">{project.address_text || 'N/A'}</p>
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

        {/* Work Orders Section */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-gray-900">Work Orders</h2>
            <Link
              href={`/work-orders/new?project_id=${project.id}&customer_id=${project.customer_id || ''}&address=${encodeURIComponent(project.address_text || '')}`}
              className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 text-sm"
            >
              + New Work Order
            </Link>
          </div>
          
          {workOrders && workOrders.length > 0 ? (
            <div className="space-y-3">
              {workOrders.map((wo: any) => (
                <div key={wo.id} className="border rounded-lg p-4 hover:bg-gray-50 transition">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono text-gray-500">{wo.work_order_number}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          wo.status === 'completed' ? 'bg-green-100 text-green-700' :
                          wo.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                          wo.status === 'scheduled' ? 'bg-purple-100 text-purple-700' :
                          wo.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {wo.status.replace('_', ' ')}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          wo.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                          wo.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {wo.priority}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 capitalize">
                          {wo.work_order_type.replace('_', ' ')}
                        </span>
                      </div>
                      <h3 className="font-medium text-gray-900 mt-2">{wo.title}</h3>
                      {wo.description && (
                        <p className="text-sm text-gray-500 mt-1 line-clamp-2">{wo.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                        {wo.assigned_user?.full_name && (
                          <span>Assigned: {wo.assigned_user.full_name}</span>
                        )}
                        {wo.assigned_sub?.company_name && (
                          <span>Sub: {wo.assigned_sub.company_name}</span>
                        )}
                        {wo.scheduled_date && (
                          <span>Scheduled: {new Date(wo.scheduled_date).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                    <Link
                      href={`/work-orders/${wo.id}`}
                      className="text-indigo-600 hover:text-indigo-800 text-sm font-medium ml-4"
                    >
                      View →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              <p className="mt-2 text-sm text-gray-500">No work orders for this project</p>
              <Link
                href={`/work-orders/new?project_id=${project.id}&customer_id=${project.customer_id || ''}&address=${encodeURIComponent(project.address_text || '')}`}
                className="mt-3 inline-block text-indigo-600 hover:text-indigo-800 text-sm font-medium"
              >
                Create first work order →
              </Link>
            </div>
          )}
        </div>

        {/* Referrals Section - shows if this project was a referral */}
        <div className="mb-6">
          <ReferralsSection
            projectId={params.id}
            orgId={profile.org_id}
            canManage={['admin', 'regional_manager', 'sales_manager', 'operations'].includes(profile.role)}
          />
        </div>

        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Operations</h2>
          <form action={updateOps} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="text-sm font-medium text-gray-500">Scope of Work</label>
              <textarea
                name="scope_of_work"
                defaultValue={project.scope_of_work ?? ''}
                rows={3}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Permits</label>
              <input
                name="permits_status"
                defaultValue={project.permits_status ?? ''}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="Requested, approved, not required"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Product</label>
              <input
                name="product_summary"
                defaultValue={project.product_summary ?? ''}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                placeholder="Shingle line, color, materials"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Install Date</label>
              <input
                name="install_date"
                type="date"
                defaultValue={project.install_date ?? ''}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm font-medium text-gray-500">Ops Notes</label>
              <textarea
                name="ops_notes"
                defaultValue={project.ops_notes ?? ''}
                rows={3}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Save Operations
              </button>
            </div>
          </form>
        </div>

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
            <div className="space-y-2">
              {files && files.length > 0 ? (
                files.map((file: any) => {
                  const fileUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/files/${file.storage_path}`
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
