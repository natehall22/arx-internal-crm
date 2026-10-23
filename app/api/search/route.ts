/** GET /api/search?q= — global search. Permission-filtered per kind (lib/global-search.ts). */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { cleanQuery, hrefForHit, runSearch, searchGroupsFor } from '@/lib/global-search'
import {
  canAccessCustomerRecordsFromPermissionNames,
  canAccessJobBoardFromPermissionNames,
  isOrgSuperuserRoleSlug,
  isRepLikeCustomerRecordRole,
} from '@/lib/permissions'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  let ctx
  try {
    ctx = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { authUser, profile } = ctx
  const q = cleanQuery(request.nextUrl.searchParams.get('q'))
  if (!q) return NextResponse.json({ results: [] })

  const admin = createServiceClient()
  const perms = await resolveEffectivePermissionNames(admin, authUser.id, profile)
  const salesDocBarred = await resolveSalesDocAccessBarred(admin, authUser.id, profile)
  const hasPerm = (...names: string[]) => perms.fullAccess || names.some((n) => perms.permissionNames.has(n))

  const groups = searchGroupsFor({
    userId: authUser.id,
    role: profile.role,
    isSuperuser: isOrgSuperuserRoleSlug(profile.role),
    canCustomers: canAccessCustomerRecordsFromPermissionNames(perms),
    customersRepScoped: isRepLikeCustomerRecordRole(profile.role),
    canJobBoard: canAccessJobBoardFromPermissionNames(perms),
    canProposals: !salesDocBarred,
    canOpportunities: hasPerm('opportunities:view', 'opportunities:edit'),
  })
  if (groups.length === 0) return NextResponse.json({ results: [] })

  try {
    const hits = await runSearch(admin, profile.org_id, q, groups)
    return NextResponse.json({ results: hits.map((h) => ({ ...h, href: hrefForHit(h) })) })
  } catch (e) {
    console.error('global search failed', e)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
