import { NextResponse } from 'next/server'

import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { authUser, profile } = await requireAuthApi()
    const admin = createServiceClient()

    const { fullAccess, permissionNames } = await resolveEffectivePermissionNames(admin, authUser.id, {
      role: profile.role as string,
      custom_role_id: profile.custom_role_id,
    })

    return NextResponse.json({
      role: profile.role,
      fullAccess,
      permissions: Array.from(permissionNames).sort(),
    })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Account disabled')) {
      return NextResponse.json({ error: e.message }, { status: 401 })
    }
    console.error('GET /api/me/effective-permissions', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
