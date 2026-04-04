/**
 * Count unique opportunities for sits/sales in a period when attributing credit
 * to multiple reps (setter + closer). Summing per-rep sit/sale rows can exceed
 * these numbers; use these for org/team "how many deals" totals.
 */
export type OppWithAttribution = {
  id: string
  setter_user_id: string | null
  owner_user_id: string | null
}

export function distinctDealCountsForMemberScope(
  memberIds: string[],
  sitOpportunities: OppWithAttribution[],
  salesOpportunities: OppWithAttribution[],
) {
  if (memberIds.length === 0) {
    return { sitOpportunitiesInPeriod: 0, saleOpportunitiesInPeriod: 0 }
  }
  const memberIdSet = new Set(memberIds)
  const inScope = (o: OppWithAttribution) =>
    memberIdSet.has(o.setter_user_id || '') || memberIdSet.has(o.owner_user_id || '')

  const scopedSits = sitOpportunities.filter(inScope)
  const scopedSales = salesOpportunities.filter(inScope)

  return {
    sitOpportunitiesInPeriod: new Set(scopedSits.map((o) => o.id)).size,
    saleOpportunitiesInPeriod: new Set(scopedSales.map((o) => o.id)).size,
  }
}
