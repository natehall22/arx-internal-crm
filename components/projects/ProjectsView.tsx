import Link from 'next/link'

import Nav from '@/components/Nav'
import { projectStatusLabelForJobStatus } from '@/lib/job-status'

function leadFromProject(project: any) {
  if (!project.leads) return null
  return Array.isArray(project.leads) ? project.leads[0] : project.leads
}

function customerDisplayName(project: any) {
  return project.customers?.name || leadFromProject(project)?.homeowner_name || '—'
}

function resolveDisplayStatus(project: any) {
  const jobs = Array.isArray(project.production_jobs) ? project.production_jobs : []
  if (jobs.length > 0 && jobs[0]?.status) {
    return projectStatusLabelForJobStatus(jobs[0].status)
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


export type ProjectsViewProps = {
  projects: any[] | null
  projectsError: string | null
  /** Closer name per project id (linked opportunity owner, else project owner). */
  closerByProjectId: Record<string, string>
}

/** The Projects list screen. Presentational only: the page loads the data, the phone check renders it with fixtures. */
export default function ProjectsView({ projects, projectsError, closerByProjectId }: ProjectsViewProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="mb-5">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Projects</h1>
          <p className="mt-1 text-sm text-gray-500">
            Active jobs — closer is from the linked opportunity when available, otherwise project owner.
          </p>
          {projectsError && (
            <p className="mt-2 text-sm text-red-600 font-medium">Query error: {projectsError}</p>
          )}
        </div>

        <div className="md:hidden space-y-2">
          {projects && projects.length > 0 ? (
            projects.map((project: any) => {
              const displayStatus = resolveDisplayStatus(project)
              const customerName = customerDisplayName(project)
              const closer = closerByProjectId[project.id] ?? '—'
              return (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="block bg-white rounded-lg border border-gray-200 px-3 py-3 active:bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-gray-900 text-[15px] leading-snug">{customerName}</span>
                    <span
                      className={`shrink-0 px-2 py-0.5 text-xs font-medium rounded-full capitalize ${statusBadgeClass(displayStatus)}`}
                    >
                      {displayStatus}
                    </span>
                  </div>
                  {project.address_text && (
                    <p className="mt-0.5 text-sm text-gray-600 line-clamp-2">{project.address_text}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                    <span>
                      <span className="text-gray-400">Closer </span>
                      <span className="font-medium text-gray-700">{closer}</span>
                    </span>
                    {project.project_type && (
                      <span className="capitalize px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{project.project_type}</span>
                    )}
                  </div>
                </Link>
              )
            })
          ) : (
            <p className="text-center text-gray-500 py-10 text-sm">No projects yet</p>
          )}
        </div>

        <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  Customer
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  Address
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  Closer
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  Type
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {projects && projects.length > 0 ? (
                projects.map((project: any) => {
                  const displayStatus = resolveDisplayStatus(project)
                  const closer = closerByProjectId[project.id] ?? '—'
                  return (
                    <tr key={project.id} className="hover:bg-gray-50/80">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/projects/${project.id}`}
                          className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                        >
                          {customerDisplayName(project)}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 max-w-[240px]">
                        <span className="text-sm text-gray-700 line-clamp-2">{project.address_text || '—'}</span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="text-sm text-gray-900">{closer}</span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 capitalize">
                          {project.project_type || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${statusBadgeClass(displayStatus)}`}
                        >
                          {displayStatus}
                        </span>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">
                    No projects yet
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
