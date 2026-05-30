export function formatPayrollMoney(n: number | null | undefined): string {
  const v = Number(n) || 0
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function formatParticipantRoleLabel(role: string): string {
  if (role === 'owner' || role === 'closer') return 'Closer'
  if (role === 'sales_rep') return 'Sales rep'
  if (role === 'setter') return 'Setter'
  if (role === 'field_manager') return 'Field manager'
  if (role === 'senior_manager') return 'Senior manager'
  return role.replace(/_/g, ' ')
}

export function holdStatusLabel(
  status: 'held_till_install' | 'released' | 'paid' | null
): string {
  if (status === 'held_till_install') return 'On hold'
  if (status === 'released') return 'Released'
  if (status === 'paid') return 'Paid'
  return '—'
}

export function holdStatusClass(
  status: 'held_till_install' | 'released' | 'paid' | null
): string {
  if (status === 'held_till_install') return 'bg-amber-100 text-amber-900'
  if (status === 'released') return 'bg-green-100 text-green-800'
  if (status === 'paid') return 'bg-indigo-100 text-indigo-800'
  return 'bg-gray-100 text-gray-600'
}
