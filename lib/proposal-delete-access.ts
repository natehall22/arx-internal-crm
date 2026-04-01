/** Roles that may delete any org proposal that is not in a final customer state */
export const PROPOSAL_DELETE_PRIVILEGED_ROLES: readonly string[] = [
  'admin',
  'manager',
  'regional_manager',
  'sales_manager',
]

export function userCanDeleteProposal(params: {
  status: string
  createdBy: string | null | undefined
  currentUserId: string
  role: string
}): boolean {
  if (params.status === 'accepted' || params.status === 'declined') return false
  if (PROPOSAL_DELETE_PRIVILEGED_ROLES.includes(params.role)) return true
  return params.createdBy === params.currentUserId
}
