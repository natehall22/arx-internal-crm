const CANVASS_SOURCES = new Set(['door_to_door', 'canvass', 'door_knock'])
const CONTACT_DISPOSITIONS = new Set(['go_back', 'hot_lead', 'not_interested', 'renter'])

type CanvassDispositionConfig = {
  id?: string | null
  active?: boolean | null
  category?: string | null
  counts_as_contact?: boolean | null
}

export function isCanvassDoorLead(lead: {
  source?: string | null
  canvass_disposition?: string | null
}): boolean {
  return CANVASS_SOURCES.has(String(lead.source || '').toLowerCase()) || Boolean(lead.canvass_disposition)
}

export function getContactDispositionIdSet(
  dispositions: CanvassDispositionConfig[] | undefined | null
): Set<string> {
  if (!Array.isArray(dispositions) || dispositions.length === 0) {
    return new Set(CONTACT_DISPOSITIONS)
  }

  const configured = dispositions
    .filter((d) => d.active !== false)
    .filter((d) => d.counts_as_contact === true)
    .map((d) => String(d.id || ''))
    .filter(Boolean)

  return new Set(configured)
}

export function isContactDisposition(
  disposition: string | null | undefined,
  contactDispositionIds: Set<string> = CONTACT_DISPOSITIONS
): boolean {
  return contactDispositionIds.has(String(disposition || ''))
}
