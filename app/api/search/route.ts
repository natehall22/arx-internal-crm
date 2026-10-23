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
import { searchMessages } from '@/lib/threads/search'
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

  // Conversation hits: same visibility rules as the thread itself (search_messages applies message_visible_to).
  const messageHits = async () => {
    try {
      const rows = await searchMessages(admin, profile.org_id, authUser.id, q, 5)
      return rows
        .filter((r) => r.href)
        .map((r) => ({
          kind: 'message' as const,
          id: r.id,
          title: r.body.length > 70 ? `${r.body.slice(0, 70)}…` : r.body,
          subtitle: `Note · ${new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
          href: r.href as string,
        }))
    } catch (e) {
      console.error('message search failed', e)
      return []
    }
  }
  if (groups.length === 0) return NextResponse.json({ results: await messageHits() })

  try {
    const [hits, msgs] = await Promise.all([runSearch(admin, profile.org_id, q, groups), messageHits()])
    return NextResponse.json({ results: [...hits.map((h) => ({ ...h, href: hrefForHit(h) })), ...msgs] })
  } catch (e) {
    console.error('global search failed', e)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
