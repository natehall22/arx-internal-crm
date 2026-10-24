export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import ProjectsView from '@/components/projects/ProjectsView'
import { notFound } from 'next/navigation'
import {
  canAccessProjectsFromPermissionNames,
  canViewAllProjects,
  canViewManagedProjects,
  isBarredFromProjectsUi,
  isRepLikeCustomerRecordRole,
} from '@/lib/permissions'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'

export default async function ProjectsPage() {
  const { profile, authUser } = await requireAuth()
  const supabase = createServiceClient()
  const projectPermissions = await resolveEffectivePermissionNames(supabase, authUser.id, profile)
  if (
    isBarredFromProjectsUi(profile.role) ||
    !canAccessProjectsFromPermissionNames(projectPermissions)
  ) {
    notFound()
  }

  const viewAllProjects = canViewAllProjects(profile.role)
  const viewManagedProjects = !viewAllProjects && canViewManagedProjects(profile.role)

  let scopedUserIds: string[] = []
  if (viewManagedProjects) {
    const roleNorm = String(profile.role || '').toLowerCase()
    let usersQuery = supabase
      .from('users')
      .select('id')
      .eq('org_id', profile.org_id)

    if (roleNorm === 'regional_manager' && profile.region_id) {
      usersQuery = usersQuery.eq('region_id', profile.region_id)
    } else if ((roleNorm === 'manager' || roleNorm === 'sales_manager') && profile.team_id) {
      usersQuery = usersQuery.eq('team_id', profile.team_id)
    } else if (roleNorm !== 'operations') {
      usersQuery = usersQuery.eq('id', profile.id)
    }

    const { data: scopedUsers } = await usersQuery
    scopedUserIds = Array.from(new Set([profile.id, ...(scopedUsers || []).map((u) => u.id as string)]))
  } else if (!viewAllProjects) {
    scopedUserIds = [profile.id]
  }

  let oppIdsOwnedByMe: string[] = []
  if (!viewAllProjects) {
    let oppQuery = supabase
      .from('opportunities')
      .select('id')
      .eq('org_id', profile.org_id)
    if (scopedUserIds.length > 0) {
      // Closers (rep / sales_rep / closer): only opportunities they own — not where they appear only as setter.
      if (!viewManagedProjects && isRepLikeCustomerRecordRole(profile.role)) {
        oppQuery = oppQuery.in('owner_user_id', scopedUserIds)
      } else {
        oppQuery = oppQuery.or(
          `owner_user_id.in.(${scopedUserIds.join(',')}),setter_user_id.in.(${scopedUserIds.join(',')})`
        )
      }
    } else {
      oppQuery = oppQuery.eq('owner_user_id', profile.id)
    }
    const { data: scopedOpps } = await oppQuery
    oppIdsOwnedByMe = (scopedOpps || []).map((o) => o.id).filter(Boolean)
  }

  let projectsQuery = supabase
    .from('projects')
    .select('id, org_id, created_at, address_text, project_type, status, opportunity_id, owner_user_id, customers(name), leads(homeowner_name), production_jobs(status, updated_at)')
    .eq('org_id', profile.org_id)
    .order('created_at', { ascending: false })

  if (!viewAllProjects) {
    const filters = [
      scopedUserIds.length > 0 ? `owner_user_id.in.(${scopedUserIds.join(',')})` : null,
      oppIdsOwnedByMe.length > 0 ? `opportunity_id.in.(${oppIdsOwnedByMe.join(',')})` : null,
    ].filter(Boolean)

    if (filters.length > 0) {
      projectsQuery = projectsQuery.or(
        filters.join(',')
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

  const closerByProjectId: Record<string, string> = {}
  for (const project of projects || []) closerByProjectId[project.id] = closerLabel(project)

  return (
    <ProjectsView projects={projects} projectsError={projectsError?.message ?? null} closerByProjectId={closerByProjectId} />
  )
}
