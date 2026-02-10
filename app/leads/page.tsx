import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import LeadsClient from './LeadsClient'

export default async function LeadsPage() {
  const { profile, user } = await requireAuth()
  const supabase = createClient()

  // Check if user has inbound lead permissions
  const { data: inboundPermission } = await supabase
    .from('user_permissions')
    .select('id, permissions!inner(name)')
    .eq('user_id', user.id)
    .eq('permissions.name', 'leads:view_inbound')
    .maybeSingle()

  const canViewInbound = 
    ['admin', 'regional_manager', 'operations'].includes(profile.role) || 
    !!inboundPermission

  // Get campaigns for filtering
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id, name')
    .eq('org_id', profile.org_id)
    .eq('is_active', true)
    .order('name')

  // Get lead sources for filtering
  const { data: leadSources } = await supabase
    .from('lead_sources')
    .select('id, name')
    .eq('org_id', profile.org_id)
    .order('name')

  // Get users for filtering (if manager+)
  let users: { id: string; full_name: string }[] = []
  if (['admin', 'regional_manager', 'sales_manager'].includes(profile.role)) {
    const { data: usersData } = await supabase
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
