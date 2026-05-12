const DOOR_COUNT_SOURCES = new Set(['door_to_door', 'canvass', 'door_knock', 'csv_import'])

/** Inbound leads: disposition alone must not turn them into canvass doors (see migration 130). */
const NON_CANVASS_DISPOSITION_SOURCES = new Set(['web', 'inbound'])
const CONTACT_DISPOSITIONS = new Set(['go_back', 'hot_lead', 'not_interested', 'renter'])
export const SALE_AGREEMENT_TYPES = ['installation', 'repair'] as const

type CanvassDispositionConfig = {
  id?: string | null
  active?: boolean | null
  category?: string | null
  counts_as_contact?: boolean | null
}

export type InstallationSaleContractRow = {
  id?: string | null
  opportunity_id?: string | null
  customer_signed_at?: string | null
  /** Rep who created/sent the contract; used when opportunity owner/setter are unset for KPI attribution. */
  created_by?: string | null
  opportunity?: {
    owner_user_id?: string | null
    setter_user_id?: string | null
  } | null
  opportunities?: {
    owner_user_id?: string | null
    setter_user_id?: string | null
  } | Array<{
    owner_user_id?: string | null
    setter_user_id?: string | null
  }> | null
}

export type SaleAgreementContractRow = InstallationSaleContractRow

export type AttributedInstallationSale = {
  id: string
  opportunity_id: string | null
  owner_user_id: string | null
  setter_user_id: string | null
  signed_at: string | null
}

export type AttributedSaleAgreement = AttributedInstallationSale

/** Row shape for canvass / door reporting filters (Supabase `leads` selects). */
export type CanvassMetricsLeadRow = {
  id: string
  source?: string | null
  canvass_disposition?: string | null
  pin_attributed_user_id?: string | null
  owner_user_id?: string | null
  homeowner_name?: string | null
  address_text?: string | null
  phone?: string | null
  email?: string | null
  status?: string | null
  created_at?: string | null
  canvass_notes?: string | null
}

export function isCanvassDoorLead(lead: {
  source?: string | null
  canvass_disposition?: string | null
}): boolean {
  const src = String(lead.source || '').toLowerCase().trim()
  if (DOOR_COUNT_SOURCES.has(src)) return true
  if (Boolean(lead.canvass_disposition) && !NON_CANVASS_DISPOSITION_SOURCES.has(src)) return true
  return false
}

export function getContactDispositionIdSet(
  dispositions: CanvassDispositionConfig[] | undefined | null
): Set<string> {
  if (!Array.isArray(dispositions) || dispositions.length === 0) {
    return new Set(CONTACT_DISPOSITIONS)
  }

  const configured = dispositions
    .filter((d) => d.active !== false)
    .filter((d) => {
      const id = String(d.id || '')
      const category = String(d.category || '').toLowerCase()
      return (
        d.counts_as_contact === true ||
        (d.counts_as_contact === undefined && (CONTACT_DISPOSITIONS.has(id) || category === 'contact'))
      )
    })
    .map((d) => String(d.id || ''))
    .filter(Boolean)

  return configured.length > 0 ? new Set(configured) : new Set(CONTACT_DISPOSITIONS)
}

export function isContactDisposition(
  disposition: string | null | undefined,
  contactDispositionIds: Set<string> = CONTACT_DISPOSITIONS
): boolean {
  return contactDispositionIds.has(String(disposition || ''))
}

export function getAttributedInstallationSales(
  rows: InstallationSaleContractRow[] | null | undefined
): AttributedInstallationSale[] {
  const seen = new Set<string>()
  const sales: AttributedInstallationSale[] = []

  for (const row of rows || []) {
    const opportunityId = row.opportunity_id || null
    const dedupeKey = opportunityId || row.id || ''
    if (!dedupeKey || seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    const joinedOpportunity = Array.isArray(row.opportunities)
      ? row.opportunities[0]
      : row.opportunities || row.opportunity || null

    let ownerUserId = joinedOpportunity?.owner_user_id || null
    let setterUserId = joinedOpportunity?.setter_user_id || null
    if (!ownerUserId && !setterUserId && row.created_by) {
      ownerUserId = row.created_by
    }

    sales.push({
      id: row.id || dedupeKey,
      opportunity_id: opportunityId,
      owner_user_id: ownerUserId,
      setter_user_id: setterUserId,
      signed_at: row.customer_signed_at || null,
    })
  }

  return sales
}

export const getAttributedSaleAgreements = getAttributedInstallationSales
