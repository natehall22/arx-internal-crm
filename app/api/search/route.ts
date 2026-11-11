/** GET /api/search?q= — global search. Permission-filtered per kind (lib/global-search.ts). */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { cleanQuery, hrefForHit, runSearch } from '@/lib/global-search'
import { searchGroupsForCaller } from '@/lib/global-search-server'
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
  const groups = await searchGroupsForCaller(admin, authUser.id, profile)

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
