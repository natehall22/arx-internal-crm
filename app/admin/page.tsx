export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import { PageHeader } from '@/components/ui/page-header'
import { requireAuth } from '@/lib/auth'
import { canManageCanvassTerritories } from '@/lib/canvass-territory-manager-roles'
import { canOpenSettingsHub, visibleSettingsGroups } from '@/lib/settings-registry'

import SettingsHub from './SettingsHub'
import { isOwnerProfile, isSuperAdmin } from '@/lib/super-admin'
import JobCatchUpSettingsCard from '@/components/admin/JobCatchUpSettingsCard'
import { loadJobCatchUpSettings } from '@/lib/job-catch-up-db'
import { canEditJobCatchUpSettings } from '@/lib/job-catch-up-settings'
import { createServiceClient } from '@/lib/supabase/service'

/** Settings: every admin page in one grouped, searchable list (lib/settings-registry.ts). */
export default async function SettingsPage() {
  const { profile } = await requireAuth()
  if (!canOpenSettingsHub(profile.role)) redirect('/today')

  const groups = visibleSettingsGroups({
    canCost: ['admin', 'operations'].includes(profile.role),
    canPayroll: ['admin', 'owner', 'operations'].includes(profile.role),
    canSuperuser: ['admin', 'owner'].includes(profile.role),
    canWorkAreas: canManageCanvassTerritories(profile.role),
    canOwner: isOwnerProfile(profile),
    canSuperAdmin: isSuperAdmin(profile),
  })
  // Small org switches live as cards right here (the hub's "Job catch-up" entry links to #job-catch-up).
  const catchUp = await loadJobCatchUpSettings(createServiceClient(), profile.org_id)

  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
        <PageHeader title="Settings" subtitle="Everything you can set up, in one place." />
        <SettingsHub groups={groups} />
        <div className="mt-4 max-w-2xl">
          <JobCatchUpSettingsCard initial={{ ...catchUp, canEdit: canEditJobCatchUpSettings(profile) }} />
        </div>
      </main>
    </div>
  )
}
