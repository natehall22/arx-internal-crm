export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import SettingsBackLink from '@/components/admin/SettingsBackLink'
import { PageHeader } from '@/components/ui/page-header'
import { requireAuth } from '@/lib/auth'
import { loadOrgProfile } from '@/lib/org-profile'
import { settingsFlagsFor } from '@/lib/settings-flags'
import { canOpenSettingsHub, SETTINGS_SECTION_PREFIX, visibleSettingsItem } from '@/lib/settings-registry'
import { createServiceClient } from '@/lib/supabase/service'

import { SECTION_PAGES } from './sections'

/** One Settings card on its own page, opened from the Settings menu. Same gate as that menu entry (lib/settings-registry.ts). */
export default async function SettingsSectionPage({ params }: { params: { section: string } }) {
  const page = Object.prototype.hasOwnProperty.call(SECTION_PAGES, params.section) ? SECTION_PAGES[params.section] : undefined
  if (!page) notFound()

  const { profile } = await requireAuth()
  if (!canOpenSettingsHub(profile.role)) redirect('/today')

  const admin = createServiceClient()
  const orgProfile = await loadOrgProfile(admin, profile.org_id)
  const flags = settingsFlagsFor(profile, orgProfile)
  const shown = page.cards.filter((c) => visibleSettingsItem(`${SETTINGS_SECTION_PREFIX}${params.section}#${c.anchor}`, flags))
  if (shown.length === 0) notFound()

  const cards = await Promise.all(shown.map(async (c) => ({ anchor: c.anchor, node: await c.render({ profile, orgProfile, admin }) })))
  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        <SettingsBackLink />
        <PageHeader title={page.title} subtitle={page.subtitle} />
        <div className="flex flex-col gap-4">
          {cards.map((c) => (
            <div key={c.anchor} id={c.anchor === 'quickbooks' ? 'quickbooks' : undefined} className="flex scroll-mt-4 flex-col gap-4">
              {c.node}
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
