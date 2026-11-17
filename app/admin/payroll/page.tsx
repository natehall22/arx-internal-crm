export const dynamic = 'force-dynamic'

import { Suspense } from 'react'

import Nav from '@/components/Nav'
import SettingsBackLink from '@/components/admin/SettingsBackLink'
import PayWeekClient from '@/components/payroll/PayWeekClient'
import { requireAuth } from '@/lib/auth'
import { getOrgFeatures } from '@/lib/org-features-server'
import { isPayWeekEnabled } from '@/lib/payroll-flag'

import LegacyPayrollPage from './LegacyPayrollPage'

/** Payroll: one screen — "Pay this week". (The access gate is app/admin/payroll/layout.tsx.) */
export default async function PayrollPage() {
  // PAYROLL_PAY_WEEK_ENABLED off (the ship default): the payroll hub exactly as it was before this release.
  if (!isPayWeekEnabled()) {
    const { profile } = await requireAuth()
    return <LegacyPayrollPage features={await getOrgFeatures(profile.org_id)} />
  }
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        <SettingsBackLink />
        <Suspense fallback={null}>
          <PayWeekClient />
        </Suspense>
      </main>
    </div>
  )
}
