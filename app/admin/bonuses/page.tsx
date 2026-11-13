import Link from 'next/link'
import { redirect } from 'next/navigation'
import Nav from '@/components/Nav'
import { requireAuth } from '@/lib/auth'
import { isPayrollAdminRole, isRegionalBonusApproverRole } from '@/lib/payroll-admin-access'
import BonusApprovalClient from './BonusApprovalClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Money → Bonuses: approve every payroll_bonus_lines row (Sisu 444, setter ramp, manual, later crew bonuses).
 * Lives outside app/admin/payroll on purpose: that layout admits payroll admins only, and regional bonus approvers
 * (direct reports only, enforced by the API) must keep today's access without gaining any other payroll page.
 * Deliberately NOT under app/admin/sisu either: it is pay, so it works with Sisu / incentives switched off.
 */
export default async function BonusesPage() {
  const { profile } = await requireAuth()
  const canAccess = isPayrollAdminRole(profile.role) || isRegionalBonusApproverRole(profile.role)
  if (!canAccess) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        {isPayrollAdminRole(profile.role) && (
          <Link href="/admin/payroll" className="mb-3 inline-flex min-h-[44px] items-center text-sm font-medium text-indigo-700 hover:text-indigo-900">
            ← Payroll
          </Link>
        )}
        <BonusApprovalClient isFullAdmin={isPayrollAdminRole(profile.role)} />
      </main>
    </div>
  )
}
