export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'

import Nav from '@/components/Nav'
import { PageHeader } from '@/components/ui/page-header'
import { requireAuth } from '@/lib/auth'
import { canManageCanvassTerritories } from '@/lib/canvass-territory-manager-roles'
import { canOpenSettingsHub, visibleSettingsGroups } from '@/lib/settings-registry'

import SettingsHub from './SettingsHub'
import { isOwnerProfile, isSuperAdmin } from '@/lib/super-admin'
import CheckupSettingsCard from '@/components/admin/CheckupSettingsCard'
import JobCatchUpSettingsCard from '@/components/admin/JobCatchUpSettingsCard'
import OrgFeaturesCard from '@/components/admin/OrgFeaturesCard'
import ServicePlanSettingsCard from '@/components/admin/ServicePlanSettingsCard'
import { readStandardTier } from '@/lib/service-plans'
import { getOrgFeatures } from '@/lib/org-features-server'
import { loadCheckupSettings } from '@/lib/checkups'
import { canEditCheckupSettings } from '@/lib/checkups-settings'
import { loadJobCatchUpSettings } from '@/lib/job-catch-up-db'
import { canEditJobCatchUpSettings } from '@/lib/job-catch-up-settings'
import { createServiceClient } from '@/lib/supabase/service'

/** Settings: every admin page in one grouped, searchable list (lib/settings-registry.ts). */
export default async function SettingsPage() {
  const { profile } = await requireAuth()
  if (!canOpenSettingsHub(profile.role)) redirect('/today')

  const features = await getOrgFeatures(profile.org_id)
  const canEditFeatures = isSuperAdmin(profile)
  const groups = visibleSettingsGroups({
    features,
    canCost: ['admin', 'operations'].includes(profile.role),
    canPayroll: ['admin', 'owner', 'operations'].includes(profile.role),
    canSuperuser: ['admin', 'owner'].includes(profile.role),
    canWorkAreas: canManageCanvassTerritories(profile.role),
    canOwner: isOwnerProfile(profile),
    canSuperAdmin: isSuperAdmin(profile),
  })
  // Small org switches live as cards right here (the hub's "Job catch-up" entry links to #job-catch-up).
  const admin = createServiceClient()
  const [catchUp, checkups, { data: activeUsers }, { data: orgRow }] = await Promise.all([
    loadJobCatchUpSettings(admin, profile.org_id),
    loadCheckupSettings(admin, profile.org_id),
    admin.from('users').select('id, full_name').eq('org_id', profile.org_id).eq('active', true).order('full_name'),
    features.servicePlans && canEditFeatures ? admin.from('orgs').select('settings').eq('id', profile.org_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const userOptions = ((activeUsers ?? []) as Array<{ id: string; full_name: string | null }>).map((u) => ({ id: u.id, name: u.full_name || 'Unnamed user' }))

  return (
    <div className="min-h-screen bg-surface-subtle">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
        <PageHeader title="Settings" subtitle="Everything you can set up, in one place." />
        <SettingsHub groups={groups} />
        <div className="mt-4 flex max-w-2xl flex-col gap-4">
          {/* Owners only: turn whole parts of the app on/off for this company (lib/org-features.ts). */}
          {canEditFeatures && <OrgFeaturesCard initial={features} />}
          <JobCatchUpSettingsCard initial={{ ...catchUp, canEdit: canEditJobCatchUpSettings(profile) }} />
          <CheckupSettingsCard initial={{ ...checkups, canEdit: canEditCheckupSettings(profile) }} users={userOptions} />
          {/* Owners, when the company uses service plans: the standard plan price and which homes qualify. */}
          {features.servicePlans && canEditFeatures ? <ServicePlanSettingsCard initial={readStandardTier((orgRow as { settings?: unknown } | null)?.settings ?? null)} /> : null}
        </div>
      </main>
    </div>
  )
}
