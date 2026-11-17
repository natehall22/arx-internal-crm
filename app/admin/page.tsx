export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import { PageHeader } from '@/components/ui/page-header'
import { requireAuth } from '@/lib/auth'
import { loadOrgProfile } from '@/lib/org-profile'
import { settingsFlagsFor } from '@/lib/settings-flags'
import { canOpenSettingsHub, visibleSettingsGroups } from '@/lib/settings-registry'
import { createServiceClient } from '@/lib/supabase/service'

import LegacyAnchorRedirect from './LegacyAnchorRedirect'
import SettingsHub from './SettingsHub'

/** Settings: the menu and nothing else. Every setting opens its own page (lib/settings-registry.ts; cards at /admin/s/<slug>). */
export default async function SettingsPage() {
  const { profile } = await requireAuth()
  if (!canOpenSettingsHub(profile.role)) redirect('/today')

  // Industry profile (lib/org-profile.ts): its feature map is the same profile-aware one every gate reads.
  const orgProfile = await loadOrgProfile(createServiceClient(), profile.org_id)
  const groups = visibleSettingsGroups(settingsFlagsFor(profile, orgProfile))

  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
        <LegacyAnchorRedirect />
        <PageHeader title="Settings" subtitle="Everything you can set up, in one place." />
        <SettingsHub groups={groups} />
      </main>
    </div>
  )
}
