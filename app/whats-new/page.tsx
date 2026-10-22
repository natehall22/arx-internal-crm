import Nav from '@/components/Nav'
import { requireAuth } from '@/lib/auth'
import { ROLE_GROUP_LABELS, linesFor, roleGroupFor, type AnnouncementBody, type RoleGroup } from '@/lib/announcements'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/** A few phone screenshots per role, so people can see where things are. Files live in /public/whats-new. */
const SHOTS: Partial<Record<RoleGroup, Array<{ file: string; caption: string }>>> = {
  owner: [
    { file: 'needs-you-default.png', caption: 'Needs you: jobs missing info, each with a one-tap fix' },
    { file: 'suppliers-admin-default.png', caption: 'Settings → Suppliers: add ABC’s order email' },
    { file: 'reports-explore-chart.png', caption: 'Reports: start from a template' },
  ],
  ops: [
    { file: 'supplier-orders-default.png', caption: 'Each supplier gets its own purchase order' },
    { file: 'needs-you-default.png', caption: 'Needs you: fix missing info here' },
  ],
  closer: [{ file: 'sale-credit-confirm-credit-step.png', caption: 'Confirm setter and closer credit when the contract is signed' }],
}

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
  const shots = (group && SHOTS[group]) || []

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <main className="mx-auto max-w-2xl p-4 pb-12 text-[#2c2c2a]">
        <h1 className="mb-1 mt-2 text-2xl font-bold">What&apos;s new</h1>
        {!latest || lines.length === 0 ? (
          <p className="mt-3 text-base">Nothing new to show right now.</p>
        ) : (
          <>
            <p className="mb-4 text-sm">
              {latest.title}
              {group ? ` · for ${ROLE_GROUP_LABELS[group].toLowerCase()}` : ''}
            </p>
            <ul className="m-0 list-disc space-y-3 pl-5 text-base leading-snug">
              {lines.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
            {shots.length > 0 && (
              <div className="mt-6 space-y-6">
                {shots.map((s) => (
                  <figure key={s.file} className="m-0">
                    <img src={`/whats-new/${s.file}`} alt={s.caption} className="w-full max-w-[375px] rounded-lg border border-[#d3d1c7]" />
                    <figcaption className="mt-1 text-sm">{s.caption}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
