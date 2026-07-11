import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuthApi } from '@/lib/auth'
import { effectiveHasPermission, resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { weatherOverlayFeatureEnabled } from '@/lib/weather-footprint'
import { hasInsideSalesQueuePermissionGrant } from '@/lib/inside-sales-follow-up'

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

    // ARX Sales (iOS) is the field-canvassing app for setters/closers — inside-sales
    // queue workers run their queue from the web app and must not get app access here,
    // even though they share `opportunities:view` with closers for their web queue.
    const isInsideSalesQueueWorker = hasInsideSalesQueuePermissionGrant(effective.permissionNames)

    const canViewOpportunities = effectiveHasPermission(effective, 'opportunities:view') && !isInsideSalesQueueWorker
    // v1: LiDAR measure flow is part of the closer opportunity workflow; keep aligned with list access.
    const canUseMeasure = canViewOpportunities

    return NextResponse.json({
      app_access: !isInsideSalesQueueWorker,
      opportunities_tab: canViewOpportunities,
      measure_tab: canUseMeasure,
      weather_overlay: weatherOverlayFeatureEnabled(),
    })
  } catch (error) {
    console.error('Mobile capabilities error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to resolve capabilities' },
      { status: 500 }
    )
  }
}
