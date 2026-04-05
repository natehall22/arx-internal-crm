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

  let projectsQuery = supabase
    .from('projects')
    .select('id, org_id, created_at, address_text, project_type, status, opportunity_id, owner_user_id, customers(name), leads(homeowner_name), production_jobs(status, updated_at)')
    .eq('org_id', profile.org_id)
    .order('created_at', { ascending: false })

  if (salesRoleRestricted) {
    if (oppIdsOwnedByMe.length > 0) {
      projectsQuery = projectsQuery.or(
        `owner_user_id.eq.${profile.id},opportunity_id.in.(${oppIdsOwnedByMe.join(',')})`
      )
    } else {
      projectsQuery = projectsQuery.eq('owner_user_id', profile.id)
    }
  }

  const { data: projects, error: projectsError } = await projectsQuery
  if (projectsError) {
    console.error('[Projects] query failed:', projectsError.message, projectsError)
  }

  const oppIds = Array.from(
    new Set((projects || []).map((p) => p.opportunity_id).filter(Boolean) as string[])
  )
  const userIdsNeeded = new Set<string>()
  ;(projects || []).forEach((p) => {
    if (p.owner_user_id) userIdsNeeded.add(p.owner_user_id)
  })

  const oppOwnerByOppId = new Map<string, string | null>()
  if (oppIds.length > 0) {
    const { data: opps } = await supabase
      .from('opportunities')
      .select('id, owner_user_id')
      .in('id', oppIds)
    for (const o of opps || []) {
      oppOwnerByOppId.set(o.id, o.owner_user_id)
      if (o.owner_user_id) userIdsNeeded.add(o.owner_user_id)
    }
  }

  const userById = new Map<string, string>()
  if (userIdsNeeded.size > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, full_name')
      .in('id', Array.from(userIdsNeeded))
    for (const u of users || []) {
      userById.set(u.id, u.full_name || '—')
    }
  }

  function closerLabel(project: any) {
    const oid = project.opportunity_id as string | null
    if (oid) {
      const closerId = oppOwnerByOppId.get(oid)
      if (closerId && userById.has(closerId)) return userById.get(closerId)!
    }
    if (project.owner_user_id && userById.has(project.owner_user_id)) {
      return userById.get(project.owner_user_id)!
    }
    return '—'
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="mb-5">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Projects</h1>
          <p className="mt-1 text-sm text-gray-500">
            Active jobs — closer is from the linked opportunity when available, otherwise project owner.
          </p>
        </div>

        <div className="md:hidden space-y-2">
          {projects && projects.length > 0 ? (
            projects.map((project: any) => {
              const displayStatus = resolveDisplayStatus(project)
              const customerName = customerDisplayName(project)
              const closer = closerLabel(project)
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
                  const closer = closerLabel(project)
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
