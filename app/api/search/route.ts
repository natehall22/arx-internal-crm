/** GET /api/search?q= — global search. Permission-filtered per kind (lib/global-search.ts). */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { categoryScopeOf, dealInScope } from '@/lib/category-scope'
import { cleanQuery, hrefForHit, runSearch } from '@/lib/global-search'
import { searchGroupsForCaller } from '@/lib/global-search-server'
import { searchMessages } from '@/lib/threads/search'
import { createServiceClient } from '@/lib/supabase/service'
import { customerFileDefaultFor } from '@/lib/customer-file/redirects'
import { loadOrgProfile } from '@/lib/org-profile'

export const dynamic = 'force-dynamic'

async function keepMessagesInScope(admin: ReturnType<typeof createServiceClient>, orgId: string, scope: ReturnType<typeof categoryScopeOf>, rows: Awaited<ReturnType<typeof searchMessages>>) {
  const out: typeof rows = []
  for (const r of rows) if (await dealInScope(admin, orgId, scope, { customer_id: r.customer_id, lead_id: r.lead_id })) out.push(r)
  return out
}

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
  const groups = await searchGroupsForCaller(admin, authUser.id, profile)

  // Conversation hits: same visibility rules as the thread itself (search_messages applies message_visible_to).
  const messageHits = async () => {
    try {
      const rows0 = await searchMessages(admin, profile.org_id, authUser.id, q, 5)
      // A note lives on a deal (its customer, else its lead): outside a limited person's categories it is not shown.
      const scope = categoryScopeOf(profile)
      const rows = scope.limited ? await keepMessagesInScope(admin, profile.org_id, scope, rows0) : rows0
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
    const [msgs, orgProfile] = await Promise.all([messageHits(), loadOrgProfile(admin, profile.org_id)])
    // Keyword search over the work itself (trade, line items, work orders, notes) is for companies that sell service plans or project
    // work; every other company gets exactly the number / address / name results it always had (no viewer id = no keyword leg).
    const keywordSearch = !!(orgProfile.features.servicePlans || orgProfile.features.projectTools)
    const hits = await runSearch(admin, profile.org_id, q, groups, 20, keywordSearch ? authUser.id : undefined, categoryScopeOf(profile))
    const fileDefault = customerFileDefaultFor(profile.role, orgProfile.id)
    return NextResponse.json({ results: [...hits.map((h) => ({ ...h, href: hrefForHit(h, fileDefault) })), ...msgs] })
  } catch (e) {
    console.error('global search failed', e)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
