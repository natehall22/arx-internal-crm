import { requireAuth } from '@/lib/auth'
import { redirect } from 'next/navigation'

import { isOrgFeatureOn } from '@/lib/org-features-server'
import AdminIncentivesClient from './AdminIncentivesClient'

type PageProps = {
  searchParams: Promise<{ tab?: string }>
}

export default async function SisuIncentivesPage({ searchParams }: PageProps) {
  // requireAuth (not raw auth.getUser): same login redirect, plus the deployment-org fence.
  const { authUser, profile } = await requireAuth()
  // Sisu incentives switched off (Settings → Features): the hub keeps only the pay tool (Setter Ramp).
  if (!(await isOrgFeatureOn(profile.org_id, 'incentives'))) redirect('/admin/sisu/setter-ramp')

  const params = await searchParams
  const initialTab = params.tab === 'badges' ? 'badges' : 'heats'

  return (
    <div className="rounded-xl border border-slate-800 bg-gray-50 p-6 shadow-2xl shadow-black/20">
      <AdminIncentivesClient currentUserId={authUser.id} initialTab={initialTab} />
    </div>
  )
}
