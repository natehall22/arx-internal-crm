import { requireAuth } from '@/lib/auth'

import ExploreClient from './ExploreClient'

export const dynamic = 'force-dynamic'

export default async function ExploreReportsPage() {
  await requireAuth()
  return <ExploreClient />
}
