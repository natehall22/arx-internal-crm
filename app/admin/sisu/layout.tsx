import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import Nav from '@/components/Nav'
import SettingsBackLink from '@/components/admin/SettingsBackLink'
import { requireAuth } from '@/lib/auth'
import { isSisuAdminRole } from '@/lib/sisu-admin-access'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import SisuHubNav from './SisuHubNav'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function SisuAdminLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireAuth()

  if (!isSisuAdminRole(profile.role)) {
    redirect('/dashboard')
  }

  // Incentives switched off (Settings → Features): only the pay tool stays (Setter Ramp). Bonus approval is not part
  // of this hub any more: it is Money → Bonuses (app/admin/bonuses), independent of this layout.
  const incentivesOn = await isOrgFeatureOn(profile.org_id, 'incentives')

  return (
    <div className="min-h-screen bg-slate-950">
      <Nav />
      <div className="mx-auto max-w-7xl px-4 py-8">
        <SettingsBackLink tone="dark" className="mb-3" />

        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-400">Sisu program</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight">
            <span className="bg-gradient-to-r from-white via-indigo-100 to-indigo-300 bg-clip-text text-transparent">
              Sisu program
            </span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400">
            Heats, badges, setter ramp, and field marketer accountability.
          </p>
        </div>

        <Suspense fallback={<div className="h-11 rounded-xl border border-slate-800 bg-slate-900/70" />}>
          <SisuHubNav showIncentives={incentivesOn} />
        </Suspense>

        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}
