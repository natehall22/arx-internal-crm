import { requireAuth } from '@/lib/auth'
import { effectiveHasPermission, resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { createServiceClient } from '@/lib/supabase/service'
import { redirect } from 'next/navigation'
import Nav from '@/components/Nav'
import LeadsClient from './LeadsClient'

const LEADS_PAGE_PERMISSIONS = [
  'leads:view',
  'leads:create',
  'leads:edit',
  'leads:delete',
  'leads:assign',
  'leads:view_inbound',
  'leads:manage_inbound',
  'leads:claim_inbound',
] as const

export default async function LeadsPage() {
  const { profile, authUser: user } = await requireAuth()
  const admin = createServiceClient()

  const { fullAccess, permissionNames } = await resolveEffectivePermissionNames(admin, user.id, {
    role: profile.role,
    custom_role_id: profile.custom_role_id,
  })

  const canAccessLeads =
    fullAccess ||
    LEADS_PAGE_PERMISSIONS.some((permission) => effectiveHasPermission({ fullAccess, permissionNames }, permission))

  if (!canAccessLeads) {
    redirect('/dashboard')
  }

  const canViewInbound =
    fullAccess ||
    ['admin', 'regional_manager', 'operations'].includes(profile.role) ||
    effectiveHasPermission({ fullAccess, permissionNames }, 'leads:view_inbound') ||
    effectiveHasPermission({ fullAccess, permissionNames }, 'leads:manage_inbound') ||
    effectiveHasPermission({ fullAccess, permissionNames }, 'leads:claim_inbound')

  const { data: campaigns } = await admin
    .from('campaigns')
    .select('id, name')
    .eq('org_id', profile.org_id)
    .eq('is_active', true)
    .order('name')

  const { data: leadSources } = await admin
    .from('lead_sources')
    .select('id, name')
    .eq('org_id', profile.org_id)
    .order('name')

  let users: { id: string; full_name: string }[] = []
  if (['admin', 'regional_manager', 'sales_manager'].includes(profile.role)) {
    const { data: usersData } = await admin
      .from('users')
      .select('id, full_name')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .order('full_name')
    users = usersData || []
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <LeadsClient
        profile={profile}
        canViewInbound={canViewInbound}
        campaigns={campaigns || []}
        leadSources={leadSources || []}
        users={users}
      />
    </div>
  )
}
