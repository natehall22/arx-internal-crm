import { redirect } from 'next/navigation'

import { requireAuth } from '@/lib/auth'
import { loadOrgProfile } from '@/lib/org-profile'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * The legacy Crews screen is roofing-only. Any other kind of company has ONE crew list — Settings → Subcontractors — so an old
 * link or bookmark to /admin/crews lands there instead of on a second, empty list that plans and visits never read.
 */
export default async function CrewsLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireAuth()
  const orgProfile = await loadOrgProfile(createServiceClient(), profile.org_id)
  if (orgProfile.settingsHidden.includes('/admin/crews')) redirect('/admin/subs')
  return <>{children}</>
}
