import { requireAuth } from '@/lib/auth'
import { isOwnerProfile } from '@/lib/super-admin'

import AnnouncementsClient from './AnnouncementsClient'

export const dynamic = 'force-dynamic'

export default async function AnnouncementsPage() {
  const { profile } = await requireAuth()
  if (!isOwnerProfile(profile)) {
    return (
      <main className="mx-auto max-w-xl p-6 text-[#2c2c2a]">
        <h1 className="text-xl font-bold">Announcements</h1>
        <p className="mt-2">Only owners can manage announcements.</p>
      </main>
    )
  }
  return <AnnouncementsClient />
}
