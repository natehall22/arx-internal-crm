import type * as React from 'react'

import CheckupSettingsCard from '@/components/admin/CheckupSettingsCard'
import CrewIncentivesSettingsCard from '@/components/admin/CrewIncentivesSettingsCard'
import JobCatchUpSettingsCard from '@/components/admin/JobCatchUpSettingsCard'
import OnlinePaymentsCard from '@/components/admin/OnlinePaymentsCard'
import OrgFeaturesCard from '@/components/admin/OrgFeaturesCard'
import OrgProfileCard from '@/components/admin/OrgProfileCard'
import ProposalContentCard from '@/components/admin/ProposalContentCard'
import QuickBooksActivityCard from '@/components/admin/QuickBooksActivityCard'
import QuickBooksSetup from '@/components/admin/QuickBooksSetup'
import QuoteApprovalCard from '@/components/admin/QuoteApprovalCard'
import SalesTaxCard from '@/components/admin/SalesTaxCard'
import SigningSettingsCard from '@/components/admin/SigningSettingsCard'
import HourlyBillingSettingsCard from '@/components/billing/HourlyBillingSettingsCard'
import ServicePlanTemplatesCard from '@/components/service-plans/ServicePlanTemplatesCard'
import type { User } from '@/lib/types/database'
import { loadCheckupSettings } from '@/lib/checkups'
import { canEditCheckupSettings } from '@/lib/checkups-settings'
import { INDUSTRY_PROFILE_IDS, INDUSTRY_PROFILES } from '@/lib/industry-profiles'
import { loadJobCatchUpSettings } from '@/lib/job-catch-up-db'
import { canEditJobCatchUpSettings } from '@/lib/job-catch-up-settings'
import type { ResolvedOrgProfile } from '@/lib/org-profile'
import { loadOrgSalesTax } from '@/lib/sales-tax-server'
import { createServiceClient } from '@/lib/supabase/service'
import { orgTimeZone } from '@/lib/timezone'

export type SectionCtx = { profile: User; orgProfile: ResolvedOrgProfile; admin: ReturnType<typeof createServiceClient> }

export type SectionCard = { anchor: string; render: (c: SectionCtx) => Promise<React.ReactNode> | React.ReactNode }
export type SectionPage = { subtitle: string; cards: SectionCard[] }

/**
 * Topic page slug -> the cards on it, in order. WHO sees a card is not decided here: it is the hub entry with href
 * `/admin/s/<page>#<anchor>` in lib/settings-registry.ts (access + feature + profile), so the menu and the page cannot disagree.
 * A page with no visible card is a 404. The same entry's title/description in the hub also names the page.
 */
export const SECTION_PAGES: Record<string, SectionPage> = {
  company: {
    subtitle: 'Your type of business, and which parts of the app are on.',
    cards: [
      {
        anchor: 'industry-profile',
        render: ({ orgProfile }) => (
          <OrgProfileCard
            current={{ id: orgProfile.id, label: orgProfile.label, description: INDUSTRY_PROFILES[orgProfile.id].description, unknownStoredId: orgProfile.unknownStoredId }}
            profiles={INDUSTRY_PROFILE_IDS.map((id) => ({ id, label: INDUSTRY_PROFILES[id].label, description: INDUSTRY_PROFILES[id].description }))}
          />
        ),
      },
      { anchor: 'features', render: ({ orgProfile }) => <OrgFeaturesCard initial={orgProfile.features} /> },
    ],
  },
  payments: {
    subtitle: 'Sales tax, online payments, QuickBooks and hourly billing.',
    cards: [
      { anchor: 'sales-tax', render: async ({ admin, profile, orgProfile }) => <SalesTaxCard initial={await loadOrgSalesTax(admin, profile.org_id)} proposalWord={orgProfile.terms.proposal} /> },
      { anchor: 'online-payments', render: () => <OnlinePaymentsCard /> },
      {
        anchor: 'quickbooks',
        render: () => (
          <>
            <QuickBooksSetup />
            <QuickBooksActivityCard />
          </>
        ),
      },
      { anchor: 'hourly-billing', render: () => <HourlyBillingSettingsCard /> },
    ],
  },
  quotes: {
    subtitle: 'Proposal wording, quote links and deposits, and the e-sign notice and reminders.',
    cards: [
      { anchor: 'proposal-content', render: ({ orgProfile }) => <ProposalContentCard proposalWord={orgProfile.terms.proposal} /> },
      { anchor: 'quotes', render: () => <QuoteApprovalCard /> },
      { anchor: 'signing', render: () => <SigningSettingsCard /> },
    ],
  },
  jobs: {
    subtitle: 'Service plans, job catch-up, customer checkups and crew incentives.',
    cards: [
      { anchor: 'plan-templates', render: () => <ServicePlanTemplatesCard /> },
      {
        anchor: 'job-catch-up',
        render: async ({ admin, profile }) => {
          const catchUp = await loadJobCatchUpSettings(admin, profile.org_id)
          return <JobCatchUpSettingsCard initial={{ ...catchUp, canEdit: canEditJobCatchUpSettings(profile) }} />
        },
      },
      {
        anchor: 'checkups',
        render: async ({ admin, profile, orgProfile }) => {
          const [checkups, { data: activeUsers }, { data: orgRow }] = await Promise.all([
            loadCheckupSettings(admin, profile.org_id),
            admin.from('users').select('id, full_name').eq('org_id', profile.org_id).eq('active', true).order('full_name'),
            admin.from('orgs').select('timezone').eq('id', profile.org_id).maybeSingle(),
          ])
          const users = ((activeUsers ?? []) as Array<{ id: string; full_name: string | null }>).map((u) => ({ id: u.id, name: u.full_name || 'Unnamed user' }))
          return <CheckupSettingsCard initial={{ ...checkups, canEdit: canEditCheckupSettings(profile) }} users={users} timeZone={orgTimeZone(orgRow?.timezone)} terms={{ job: orgProfile.terms.job, jobs: orgProfile.terms.jobs }} />
        },
      },
      { anchor: 'crew-incentives', render: () => <CrewIncentivesSettingsCard /> },
    ],
  },
}
