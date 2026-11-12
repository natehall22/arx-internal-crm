import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { loadDealSaleCredit } from '@/lib/deal-sale-credit'
import { isSuperAdmin } from '@/lib/super-admin'
import { isRepLikeCustomerRecordRole } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

/**
 * Pre-fill for the "Sale credit" step on the contract screen: the deal's closer, setter and
 * self-generated flag, whether it is already locked (a sale agreement is signed), and whether
 * this viewer may still change it. Same access gate as creating the contract.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  let ctx: Awaited<ReturnType<typeof requireAuthApi>>
  try {
    ctx = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createServiceClient()
  if (await resolveSalesDocAccessBarred(admin, ctx.authUser.id, ctx.profile)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const loaded = await loadDealSaleCredit(admin, ctx.profile.org_id, params.id)
    if (!loaded) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    // Plain reps only see deals they are on (same narrowing as the opportunity API).
    if (
      isRepLikeCustomerRecordRole(ctx.profile.role) &&
      loaded.credit.closerUserId !== ctx.profile.id &&
      loaded.credit.setterUserId !== ctx.profile.id
    ) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }
    // Names for whoever the deal already names, active or not: the pick-list only holds active users, so without this
    // an inactive setter would show as "No setter" on the contract screen.
    const ids = [loaded.credit.closerUserId, loaded.credit.setterUserId].filter((v): v is string => !!v)
    const { data: named } = ids.length
      ? await admin.from('users').select('id, full_name, active').eq('org_id', ctx.profile.org_id).in('id', ids)
      : { data: [] as Array<{ id: string; full_name: string | null; active: boolean | null }> }
    const people = (named ?? []).map((u) => ({ id: u.id, name: u.full_name ?? null, active: u.active !== false }))
    return NextResponse.json({
      ...loaded.credit,
      people,
      locked: loaded.locked,
      canChange: !loaded.locked || isSuperAdmin(ctx.profile),
    })
  } catch (error) {
    console.error('GET sale-credit', error)
    return NextResponse.json({ error: 'Failed to load sale credit' }, { status: 500 })
  }
}
