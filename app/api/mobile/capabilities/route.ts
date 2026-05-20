import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuthApi } from '@/lib/auth'
import { effectiveHasPermission, resolveEffectivePermissionNames } from '@/lib/effective-permissions'

export const dynamic = 'force-dynamic'

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * GET /api/mobile/capabilities
 * ARX Sales (iOS) — which tabs/features to show. Driven by effective permissions
 * (Admin → Roles / user permission overrides), not hardcoded role slugs.
 */
export async function GET() {
  try {
    let authContext: Awaited<ReturnType<typeof requireAuthApi>>
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()
    const profile = authContext.profile
    const effective = await resolveEffectivePermissionNames(admin, authContext.authUser.id, {
      role: profile.role,
      custom_role_id: profile.custom_role_id ?? null,
    })

    const canViewOpportunities = effectiveHasPermission(effective, 'opportunities:view')
    // v1: LiDAR measure flow is part of the closer opportunity workflow; keep aligned with list access.
    const canUseMeasure = canViewOpportunities

    return NextResponse.json({
      opportunities_tab: canViewOpportunities,
      measure_tab: canUseMeasure,
    })
  } catch (error) {
    console.error('Mobile capabilities error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to resolve capabilities' },
      { status: 500 }
    )
  }
}
