import Nav from '@/components/Nav'
import { requireAuth } from '@/lib/auth'
import WhatsNewView from '@/components/WhatsNewView'
import { linesFor, roleGroupFor, type AnnouncementBody } from '@/lib/announcements'
import { WHATS_NEW_SHOTS } from '@/lib/whats-new-shots'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export default async function WhatsNewPage() {
  const { profile } = await requireAuth()
  const group = roleGroupFor(profile.role)
  const admin = createServiceClient()
  // The newest announcement that has started — still reachable after its banner window ends.
  const { data } = await admin
    .from('announcements')
    .select('title, body, starts_at')
    .eq('org_id', profile.org_id)
    .eq('active', true)
    .lte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: false })
    .limit(5)
  // The newest announcement that has copy for this person's role.
  const latest = (data ?? []).find((a) => linesFor(a.body as AnnouncementBody, group).length > 0)
  const lines = latest ? linesFor(latest.body as AnnouncementBody, group) : []
  const shots = (group && WHATS_NEW_SHOTS[group]) || []

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <WhatsNewView title={latest ? (latest.title as string) : null} group={group} lines={lines} shots={shots} />
    </div>
  )
}
