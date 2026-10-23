export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import { PageHeader } from '@/components/ui/page-header'
import { requireAuth } from '@/lib/auth'
import { canManageCanvassTerritories } from '@/lib/canvass-territory-manager-roles'
import { canOpenSettingsHub, visibleSettingsGroups } from '@/lib/settings-registry'

import SettingsHub from './SettingsHub'

/** Settings: every admin page in one grouped, searchable list (lib/settings-registry.ts). */
export default async function SettingsPage() {
  const { profile } = await requireAuth()
  if (!canOpenSettingsHub(profile.role)) redirect('/today')

  const groups = visibleSettingsGroups({
    canCost: ['admin', 'operations'].includes(profile.role),
    canPayroll: ['admin', 'owner', 'operations'].includes(profile.role),
    canSuperuser: ['admin', 'owner'].includes(profile.role),
    canWorkAreas: canManageCanvassTerritories(profile.role),
  })

  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
        <PageHeader title="Settings" subtitle="Everything you can set up, in one place." />
        <SettingsHub groups={groups} />
      </main>
    </div>
  )
}
