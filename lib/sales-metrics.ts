const CANVASS_SOURCES = new Set(['door_to_door', 'canvass', 'door_knock'])
const CONTACT_DISPOSITIONS = new Set(['go_back', 'hot_lead', 'not_interested', 'renter'])

export function isCanvassDoorLead(lead: {
  source?: string | null
  canvass_disposition?: string | null
}): boolean {
  return CANVASS_SOURCES.has(String(lead.source || '').toLowerCase()) || Boolean(lead.canvass_disposition)
}

export function isContactDisposition(disposition: string | null | undefined): boolean {
  return CONTACT_DISPOSITIONS.has(String(disposition || ''))
}
