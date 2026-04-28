export function getAttributedCanvassLeadUserId(lead: {
  pin_attributed_user_id?: string | null
  owner_user_id?: string | null
}): string | null {
  // Reporting should stick with the frozen canvass attribution when present.
  return lead.pin_attributed_user_id || lead.owner_user_id || null
}
