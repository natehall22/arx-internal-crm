type MaybeString = string | null | undefined

function normalizeLabel(value: MaybeString): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function isFinanceAdminLabel(value: MaybeString): boolean {
  const normalized = normalizeLabel(value)
  return normalized === 'finance_admin'
}

export function canAccessJobBilling(args: {
  role?: MaybeString
  customRoleName?: MaybeString
  customRoleDisplayName?: MaybeString
}): boolean {
  const role = normalizeLabel(args.role)
  if (role === 'owner' || role === 'finance_admin') {
    return true
  }

  return (
    isFinanceAdminLabel(args.customRoleName) ||
    isFinanceAdminLabel(args.customRoleDisplayName)
  )
}
