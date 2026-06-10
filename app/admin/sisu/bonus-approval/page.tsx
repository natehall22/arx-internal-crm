import { requireAuth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { isPayrollAdminRole, isRegionalBonusApproverRole } from '@/lib/payroll-admin-access'
import BonusApprovalClient from './BonusApprovalClient'

export default async function BonusApprovalPage() {
  const { profile } = await requireAuth()
  const canAccess =
    isPayrollAdminRole(profile.role) || isRegionalBonusApproverRole(profile.role)
  if (!canAccess) redirect('/admin/sisu')

  return <BonusApprovalClient isFullAdmin={isPayrollAdminRole(profile.role)} />
}
