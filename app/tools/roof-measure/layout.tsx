export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { isBarredFromRoofMeasureAccess } from '@/lib/permissions'
import { createServiceClient } from '@/lib/supabase/service'
import { notFound } from 'next/navigation'

export default async function RoofMeasureLayout({ children }: { children: React.ReactNode }) {
  const { authUser, profile } = await requireAuth()
  const supabase = createServiceClient()

  let customRoleName: string | null = null
  let customRoleDisplayName: string | null = null
  if (profile.custom_role_id) {
    const { data: customRole } = await supabase
      .from('custom_roles')
      .select('name, display_name')
      .eq('id', profile.custom_role_id)
      .maybeSingle()
    customRoleName = customRole?.name ?? null
    customRoleDisplayName = customRole?.display_name ?? null
  }

  const { permissionNames } = await resolveEffectivePermissionNames(supabase, authUser.id, {
    role: profile.role,
    custom_role_id: profile.custom_role_id,
  })

  if (
    isBarredFromRoofMeasureAccess({
      role: profile.role,
      customRoleName,
      customRoleDisplayName,
      permissionNames,
    })
  ) {
    notFound()
  }

  return children
}
