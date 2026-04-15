/** Prefer live profile name; fall back to snapshot when user row is gone. */
export function leadOwnerLabel(lead: {
  users?: { full_name?: string | null } | null
  owner_display_name?: string | null
  owner_user_id?: string | null
}): string {
  const live = lead.users?.full_name?.trim()
  if (live) return live
  const snap = lead.owner_display_name?.trim()
  if (snap) return snap
  if (lead.owner_user_id) return 'Former user'
  return 'Unassigned'
}
