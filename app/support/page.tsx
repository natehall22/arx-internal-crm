import { notFound } from 'next/navigation'

import { createServiceClient } from '@/lib/supabase/service'
import { listSupportCompanies } from '@/lib/support/access'
import { listPlanCompanies } from '@/lib/support/plans'
import { getPlatformStaffContext } from '@/lib/support/staff'

import SupportCompanies from './SupportCompanies'
import SupportPlans from './SupportPlans'

export const dynamic = 'force-dynamic'

/** Platform support staff only (server-side check against platform_support_staff). Anyone else gets a plain 404. */
export default async function SupportPage() {
  const ctx = await getPlatformStaffContext()
  if (!ctx) notFound()
  const admin = createServiceClient()
  const companies = await listSupportCompanies(admin)
  // Plans are the platform's own job: listed for every company, no support grant needed (lib/support/plans.ts).
  const plans = await listPlanCompanies(admin).catch((e) => {
    console.error('[support] plans not readable', e)
    return []
  })
  return (
    <div className="min-h-screen bg-surface-subtle">
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-[22px] font-semibold text-[#2c2c2a]">Support</h1>
        <p className="mb-4 text-[16px] text-[#2c2c2a]">Companies that allow support access. You start in view-only mode; every visit is logged and shown to the company.</p>
        <SupportCompanies companies={companies.map((c) => ({ orgId: c.orgId, name: c.name, always: c.access.kind === 'always', expiresAt: c.access.kind === 'grant' ? c.access.expiresAt : null, users: c.users }))} />
        <SupportPlans companies={plans} />
      </main>
    </div>
  )
}
