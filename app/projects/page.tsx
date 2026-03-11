import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import Link from 'next/link'

function mapJobStatusToProjectStatus(jobStatus: string) {
  if (jobStatus === 'collected') return 'collected'
  if (jobStatus === 'complete') return 'complete'
  if (jobStatus === 'on_hold') return 'on hold'
  return 'in progress'
}

function resolveDisplayStatus(project: any) {
  const jobs = Array.isArray(project.production_jobs) ? project.production_jobs : []
  if (jobs.length > 0 && jobs[0]?.status) {
    return mapJobStatusToProjectStatus(jobs[0].status)
  }
  return String(project.status || 'open').replace('_', ' ')
}

function statusBadgeClass(status: string) {
  if (status === 'collected') return 'bg-gray-100 text-gray-800'
  if (status === 'complete') return 'bg-green-100 text-green-800'
  if (status === 'on hold') return 'bg-orange-100 text-orange-800'
  if (status === 'in progress') return 'bg-blue-100 text-blue-800'
  return 'bg-blue-100 text-blue-800'
}

export default async function ProjectsPage() {
  const { profile } = await requireAuth()
  const supabase = createClient()

  let projectsQuery = supabase
    .from('projects')
    .select('*, customers(name), leads(homeowner_name), production_jobs(status, updated_at)')
    .eq('org_id', profile.org_id)
    .order('created_at', { ascending: false })

  // Closers/sales reps only see projects they own
  if (['rep', 'sales_rep', 'closer'].includes(profile.role)) {
    projectsQuery = projectsQuery.eq('owner_user_id', profile.id)
  }

  const { data: projects } = await projectsQuery

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Projects</h1>
        </div>

        <div className="bg-white shadow rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Customer
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Address
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {projects && projects.length > 0 ? (
                projects.map((project: any) => {
                  const displayStatus = resolveDisplayStatus(project)
                  return (
                  <tr key={project.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {project.customers?.name || project.leads?.homeowner_name || 'N/A'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">{project.address_text || 'N/A'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800 capitalize">
                        {project.project_type}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full capitalize ${statusBadgeClass(displayStatus)}`}>
                        {displayStatus}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-indigo-600 hover:text-indigo-900"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                    No projects found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
