import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import ReferralsSection from '@/components/ReferralsSection'
import CustomerInfoCard from '@/components/customers/CustomerInfoCard'

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'leads', label: 'Leads' },
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'projects', label: 'Projects' },
  { id: 'referrals', label: 'Referrals' },
  { id: 'work-orders', label: 'Work Orders' },
  { id: 'files', label: 'Files' },
  { id: 'activity', label: 'Activity' },
]

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams?: { tab?: string }
}) {
  const { profile } = await requireAuth()
  const supabase = createClient()
  const activeTab = searchParams?.tab ?? 'overview'

  const { data: customer } = await supabase
    .from('customers')
    .select('*')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (!customer) {
    notFound()
  }

  let projectsQuery = supabase
    .from('projects')
    .select('*')
    .eq('customer_id', params.id)
    .eq('org_id', profile.org_id)
    .order('created_at', { ascending: false })

  if (profile.role === 'rep') {
    projectsQuery = projectsQuery.eq('owner_user_id', profile.id)
  }

  const { data: projects } = await projectsQuery
  if (profile.role === 'rep' && (!projects || projects.length === 0)) {
    notFound()
  }

  let opportunitiesQuery = supabase
    .from('opportunities')
    .select('*')
    .eq('customer_id', params.id)
    .eq('org_id', profile.org_id)
    .order('created_at', { ascending: false })

  if (profile.role === 'rep') {
    opportunitiesQuery = opportunitiesQuery.eq('owner_user_id', profile.id)
  }

  const { data: opportunities } = await opportunitiesQuery

  const leadIds = Array.from(
    new Set(
      [
        ...(projects || []).map((project) => project.lead_id).filter(Boolean),
        ...(opportunities || []).map((opportunity) => opportunity.lead_id).filter(Boolean),
      ] as string[]
    )
  )

  const { data: leads } =
    leadIds.length > 0
      ? await supabase.from('leads').select('*').in('id', leadIds)
      : { data: [] }

  const projectIds = (projects || []).map((project) => project.id)
  const opportunityIds = (opportunities || []).map((opportunity) => opportunity.id)

  let filesQuery = supabase
    .from('files')
    .select('*')
    .eq('org_id', profile.org_id)
    .order('created_at', { ascending: false })

  if (projectIds.length > 0 || opportunityIds.length > 0) {
    const filters = [
      `customer_id.eq.${params.id}`,
      projectIds.length > 0 ? `project_id.in.(${projectIds.join(',')})` : null,
      opportunityIds.length > 0 ? `opportunity_id.in.(${opportunityIds.join(',')})` : null,
    ].filter(Boolean)
    filesQuery = filesQuery.or(filters.join(','))
  } else {
    filesQuery = filesQuery.eq('customer_id', params.id)
  }

  const { data: files } = await filesQuery

  let activitiesQuery = supabase
    .from('activities')
    .select('*, users(full_name)')
    .eq('org_id', profile.org_id)
    .order('created_at', { ascending: false })

  const activityFilters = [
    `customer_id.eq.${params.id}`,
    projectIds.length > 0 ? `project_id.in.(${projectIds.join(',')})` : null,
    opportunityIds.length > 0 ? `opportunity_id.in.(${opportunityIds.join(',')})` : null,
  ].filter(Boolean)

  if (activityFilters.length > 0) {
    activitiesQuery = activitiesQuery.or(activityFilters.join(','))
  }

  const { data: activities } = await activitiesQuery

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Link
            href="/customers"
            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
          >
            ← Back to Customers
          </Link>
        </div>

        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Customer File</h1>
              <p className="text-sm text-gray-500">Use the tabs to review this account.</p>
            </div>
          </div>
        </div>

        <div className="mb-6 border-b border-gray-200">
          <nav className="-mb-px flex flex-wrap gap-4">
            {tabs.map((tab) => (
              <Link
                key={tab.id}
                href={`/customers/${params.id}?tab=${tab.id}`}
                className={`pb-3 text-sm font-medium ${
                  activeTab === tab.id
                    ? 'border-b-2 border-indigo-600 text-indigo-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-6">
            <CustomerInfoCard customer={customer} />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-sm font-medium text-gray-500">Projects</h2>
                <p className="mt-2 text-2xl font-semibold text-gray-900">
                  {projects?.length || 0}
                </p>
              </div>
              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-sm font-medium text-gray-500">Opportunities</h2>
                <p className="mt-2 text-2xl font-semibold text-gray-900">
                  {opportunities?.length || 0}
                </p>
              </div>
              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-sm font-medium text-gray-500">Files</h2>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{files?.length || 0}</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'leads' && (
          <div className="space-y-4">
            {leads && leads.length > 0 ? (
              leads.map((lead: any) => (
                <div key={lead.id} className="bg-white shadow rounded-lg p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">
                        {lead.homeowner_name || 'Lead'}
                      </h2>
                      <p className="text-sm text-gray-500 capitalize">
                        {lead.status.replace('_', ' ')}
                      </p>
                    </div>
                    <Link
                      href={`/leads/${lead.id}`}
                      className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                    >
                      Open lead →
                    </Link>
                  </div>
                </div>
              ))
            ) : (
              <div className="bg-white shadow rounded-lg p-6 text-sm text-gray-500">
                No leads found for this customer.
              </div>
            )}
          </div>
        )}

        {activeTab === 'opportunities' && (
          <div className="space-y-4">
            {opportunities && opportunities.length > 0 ? (
              opportunities.map((opportunity: any) => (
                <div key={opportunity.id} className="bg-white shadow rounded-lg p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">
                        {opportunity.project_type}
                      </h2>
                      <p className="text-sm text-gray-500 capitalize">
                        {opportunity.status.replace('_', ' ')}
                      </p>
                    </div>
                    <Link
                      href={`/opportunities/${opportunity.id}`}
                      className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                    >
                      Open opportunity →
                    </Link>
                  </div>
                  <p className="mt-2 text-sm text-gray-600">
                    {opportunity.address_text || 'No address'}
                  </p>
                </div>
              ))
            ) : (
              <div className="bg-white shadow rounded-lg p-6 text-sm text-gray-500">
                No opportunities found for this customer.
              </div>
            )}
          </div>
        )}

        {activeTab === 'projects' && (
          <div className="space-y-4">
            {projects && projects.length > 0 ? (
              projects.map((project) => (
                <div key={project.id} className="bg-white shadow rounded-lg p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">
                        {project.project_type}
                      </h2>
                      <p className="text-sm text-gray-500 capitalize">
                        {project.status.replace('_', ' ')}
                      </p>
                    </div>
                    <Link
                      href={`/projects/${project.id}`}
                      className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                    >
                      Open project →
                    </Link>
                  </div>
                  <p className="mt-2 text-sm text-gray-600">{project.address_text || 'N/A'}</p>
                </div>
              ))
            ) : (
              <div className="bg-white shadow rounded-lg p-6 text-sm text-gray-500">
                No projects found for this customer.
              </div>
            )}
          </div>
        )}

        {activeTab === 'referrals' && (
          <ReferralsSection
            customerId={params.id}
            customerName={customer.name || undefined}
            orgId={profile.org_id}
            canManage={['admin', 'regional_manager', 'sales_manager', 'operations'].includes(profile.role)}
          />
        )}

        {activeTab === 'work-orders' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Link
                href={`/work-orders/new?customer=${params.id}`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Work Order
              </Link>
            </div>
            <div className="bg-white shadow rounded-lg p-6">
              <p className="text-gray-500 text-sm">
                Work orders for this customer will appear here. Create a go-back, repair, or service work order using the button above.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'files' && (
          <div className="bg-white shadow rounded-lg p-6">
            <div className="space-y-2">
              {files && files.length > 0 ? (
                files.map((file: any) => (
                  <div key={file.id} className="flex items-center justify-between p-2 border rounded">
                    <span className="text-sm text-gray-900">{file.file_name}</span>
                    <span className="text-xs text-gray-500 capitalize">{file.tag}</span>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 text-sm">No files found for this customer.</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="bg-white shadow rounded-lg p-6">
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
                <p className="text-gray-500 text-sm">No activity yet.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
