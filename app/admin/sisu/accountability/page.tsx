import { requireAuth } from '@/lib/auth'
import { requireOrgFeaturePage } from '@/lib/org-features-server'

import AccountabilityClient from './AccountabilityClient'

export default async function AccountabilityPage() {
  const { profile } = await requireAuth()
  await requireOrgFeaturePage(profile.org_id, 'incentives')
  return <AccountabilityClient />
}
