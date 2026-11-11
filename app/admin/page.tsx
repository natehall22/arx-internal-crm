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
import OrgProfileCard from '@/components/admin/OrgProfileCard'
import { INDUSTRY_PROFILE_IDS, INDUSTRY_PROFILES } from '@/lib/industry-profiles'
import { loadOrgProfile } from '@/lib/org-profile'
import SalesTaxCard from '@/components/admin/SalesTaxCard'
import { loadOrgSalesTax } from '@/lib/sales-tax-server'
import ServicePlanTemplatesCard from '@/components/service-plans/ServicePlanTemplatesCard'
import { loadCheckupSettings } from '@/lib/checkups'
import { canEditCheckupSettings } from '@/lib/checkups-settings'
import { loadJobCatchUpSettings } from '@/lib/job-catch-up-db'
import { canEditJobCatchUpSettings } from '@/lib/job-catch-up-settings'
import { createServiceClient } from '@/lib/supabase/service'

/** Settings: every admin page in one grouped, searchable list (lib/settings-registry.ts). */
export default async function SettingsPage() {
  const { profile } = await requireAuth()
  if (!canOpenSettingsHub(profile.role)) redirect('/today')

  const admin = createServiceClient()
  // Industry profile (lib/org-profile.ts): its feature map is the same profile-aware one every gate reads.
  const orgProfile = await loadOrgProfile(admin, profile.org_id)
  const features = orgProfile.features
  const canEditFeatures = isSuperAdmin(profile)
  const groups = visibleSettingsGroups({
    features,
    terms: orgProfile.terms,
    canCost: ['admin', 'operations'].includes(profile.role),
    canPayroll: ['admin', 'owner', 'operations'].includes(profile.role),
    canSuperuser: ['admin', 'owner'].includes(profile.role),
    canWorkAreas: canManageCanvassTerritories(profile.role),
    canOwner: isOwnerProfile(profile),
    canSuperAdmin: isSuperAdmin(profile),
  })
  // Small org switches live as cards right here (the hub's "Job catch-up" entry links to #job-catch-up).
  const [catchUp, checkups, { data: activeUsers }, salesTax] = await Promise.all([
    loadJobCatchUpSettings(admin, profile.org_id),
    loadCheckupSettings(admin, profile.org_id),
    admin.from('users').select('id, full_name').eq('org_id', profile.org_id).eq('active', true).order('full_name'),
    canEditFeatures ? loadOrgSalesTax(admin, profile.org_id) : Promise.resolve(null),
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
          {canEditFeatures && (
            <OrgProfileCard
              current={{ id: orgProfile.id, label: orgProfile.label, description: INDUSTRY_PROFILES[orgProfile.id].description, unknownStoredId: orgProfile.unknownStoredId }}
              profiles={INDUSTRY_PROFILE_IDS.map((id) => ({ id, label: INDUSTRY_PROFILES[id].label, description: INDUSTRY_PROFILES[id].description }))}
            />
          )}
          {canEditFeatures && <OrgFeaturesCard initial={features} />}
          {/* Owners only: sales tax rates, default stack, on/off (lib/sales-tax.ts). */}
          {canEditFeatures && <SalesTaxCard initial={salesTax} proposalWord={orgProfile.terms.proposal} />}
          <JobCatchUpSettingsCard initial={{ ...catchUp, canEdit: canEditJobCatchUpSettings(profile) }} />
          <CheckupSettingsCard initial={{ ...checkups, canEdit: canEditCheckupSettings(profile) }} users={userOptions} />
          {/* Owners, when the company uses service plans: what it sells (plan templates). */}
          {features.servicePlans && canEditFeatures ? <ServicePlanTemplatesCard /> : null}
        </div>
      </main>
    </div>
  )
}
