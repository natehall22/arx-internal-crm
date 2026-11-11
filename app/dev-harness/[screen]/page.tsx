'use client'

/**
 * Mobile-pass harness: renders client screens with no login so Playwright (e2e/mobile.spec.ts) can mock
 * their /api calls and check them at phone widths. Dev only — it 404s in production builds.
 */
import { notFound } from 'next/navigation'
import { useState } from 'react'

import CompleteJobModal from '@/components/ops/CompleteJobModal'
import JobDocumentsBanner from '@/components/ops/JobDocumentsBanner'
import JobMaterialsCard from '@/components/ops/JobMaterialsCard'
import NeedsYouList from '@/components/ops/NeedsYouList'
import CheckupList from '@/components/checkups/CheckupList'
import MoveFromJobber from '@/components/jobber-import/MoveFromJobber'
import { HARNESS_CHECKUPS } from '@/e2e/fixtures'
import { HARNESS_CREW_DAY, HARNESS_CLOCK_STATE, HARNESS_CLOCK_STATE_IN, HARNESS_TIME_WEEK } from '@/e2e/fixtures'
import JobClockCard from '@/components/time/JobClockCard'
import TimeWeekClient from '@/components/time/TimeWeekClient'
import TimeClockSettingsCard from '@/components/time/TimeClockSettingsCard'
import CrewTimeSetup from '@/components/time/CrewTimeSetup'
import type { ClockState } from '@/components/time/useClock'
import type { TimeWeek } from '@/lib/time-tracking-db'
import WhatsNewView from '@/components/WhatsNewView'
import { ROLE_GROUPS } from '@/lib/announcements'
import { WHATS_NEW_SHOTS } from '@/lib/whats-new-shots'
import SupplierOrdersCard from '@/components/ops/SupplierOrdersCard'
import JobReadyToPayBanner from '@/components/ops/JobReadyToPayBanner'
import JobPayrollSentBanner from '@/components/ops/JobPayrollSentBanner'
import SuppliersClient from '@/app/admin/suppliers/SuppliersClient'
import ContractSigningForm from '@/app/contracts/sign/[token]/CustomerSigningForm'
import ChangeOrderSigningForm from '@/app/change-orders/sign/[token]/CustomerSigningForm'
import CrewPhotoCapture from '@/app/crew/[token]/CrewPhotoCapture'
import MovedHostNotice, { type HandoffDeps } from '@/app/(canvass-app)/canvass/components/MovedHostNotice'
import { HARNESS_CONTRACT } from '@/e2e/fixtures'
import { DEFAULT_DOCUMENT_BRAND } from '@/lib/org-brand'
import { noticeOfCancellation } from '@/lib/contracts/terms'
import PayrollAttributionEditor from '@/components/payroll/PayrollAttributionEditor'
import OpsClient from '@/app/ops/OpsClient'
import OpsDashboardView from '@/components/ops/OpsDashboardView'
import ProjectsView from '@/components/projects/ProjectsView'
import IncentivesClient from '@/app/sisu/IncentivesClient'
import { HARNESS_INCENTIVES, HARNESS_PROJECTS } from '@/e2e/fixtures'
import InsideSalesPage from '@/app/inside-sales/page'
import InstallScheduleClient from '@/app/ops/schedule/InstallScheduleClient'
import ReferralPartnersClient from '@/app/referral-partners/ReferralPartnersClient'
import { HARNESS_OPS_DASHBOARD } from '@/e2e/fixtures'
import AppointmentsList from '@/components/appointments/AppointmentsList'
import { HARNESS_OPS_JOBS, HARNESS_WORK_ORDERS, HARNESS_CUSTOMERS, HARNESS_PROFIT_ROWS } from '@/e2e/fixtures'
import WorkOrdersClient from '@/app/work-orders/WorkOrdersClient'
import CustomersPageClient from '@/components/customers/CustomersPageClient'
import JobProfitTable from '@/components/admin/JobProfitTable'
import ProposalsPage from '@/app/proposals/page'
import LeadsClient from '@/app/leads/LeadsClient'
import OpportunitiesPage from '@/app/opportunities/page'
import JobDetailClient from '@/app/ops/jobs/[id]/JobDetailClient'
import { HARNESS_JOB, HARNESS_JOB_0037 } from '@/e2e/fixtures'
import AnnouncementBanner from '@/components/AnnouncementBanner'
import AnnouncementsClient from '@/app/admin/announcements/AnnouncementsClient'
import ContractModal from '@/components/contracts/ContractModal'
import ExploreClient from '@/app/reports/explore/ExploreClient'
import ReportsPage from '@/app/reports/page'
import PayWeekClient from '@/components/payroll/PayWeekClient'
import MyPayClient from '@/components/payroll/MyPayClient'
import DefaultPlansCard from '@/components/admin/DefaultPlansCard'
import { HARNESS_NEEDS_YOU, HARNESS_RUN_SHEET, HARNESS_DASHBOARD } from '@/e2e/fixtures'
import JobSheetsEditor from '@/app/ops/jobs/[id]/sheets/JobSheetsEditor'
import DashboardClient from '@/app/dashboard/DashboardClient'
import UiKitHarness from '@/components/ui/UiKitHarness'
import Nav from '@/components/Nav'
import SettingsHub from '@/app/admin/SettingsHub'
import JobSetupClient from '@/app/admin/job-setup/JobSetupClient'
import CustomFieldsClient from '@/app/admin/custom-fields/CustomFieldsClient'
import CustomFieldsCard from '@/components/custom-fields/CustomFieldsCard'
import PropertiesCard from '@/components/customer-file/PropertiesCard'
import CustomerDocumentsCard from '@/components/customer-file/CustomerDocumentsCard'
import { HARNESS_CUSTOM_FIELDS, HARNESS_PROPERTIES, HARNESS_CUSTOMER_DOCUMENTS } from '@/e2e/fixtures'
import type { CustomFieldDefinition } from '@/lib/custom-fields'
import type { Property } from '@/lib/properties'
import { visibleSettingsGroups } from '@/lib/settings-registry'
import { QueueCard, KpiTiles } from '@/components/today/QueueCard'
import FileHeader from '@/components/customer-file/FileHeader'
import FileTabs from '@/components/customer-file/FileTabs'
import ThreadPanel from '@/components/customer-file/ThreadPanel'
import { HARNESS_FILE_CTX } from '@/e2e/fixtures'
import { HARNESS_QUEUES } from '@/e2e/fixtures'
import EmailBlastsPage from '@/app/admin/email-blasts/page'
import GeneralSettingsCard, { type GeneralSettingsValues } from '@/components/admin/GeneralSettingsCard'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'
import JobCatchUpSettingsCard from '@/components/admin/JobCatchUpSettingsCard'
import OrgFeaturesCard from '@/components/admin/OrgFeaturesCard'
import OrgProfileCard from '@/components/admin/OrgProfileCard'
import { INDUSTRY_PROFILE_IDS, INDUSTRY_PROFILES } from '@/lib/industry-profiles'
import SalesTaxCard from '@/components/admin/SalesTaxCard'
import TaxExemptionCard from '@/components/customer/TaxExemptionCard'
import ServicePlanTemplatesCard from '@/components/service-plans/ServicePlanTemplatesCard'
import ServicePlansCard from '@/components/service-plans/ServicePlansCard'
import VisitsBoard from '@/components/service-plans/VisitsBoard'
import ReadyToBill from '@/components/billing/ReadyToBill'
import HoursToBill from '@/components/billing/HoursToBill'
import JobHourlyCard from '@/components/billing/JobHourlyCard'
import HourlyBillingSettingsCard from '@/components/billing/HourlyBillingSettingsCard'
import CustomerInvoicesCard from '@/components/billing/CustomerInvoicesCard'
import PayClient from '@/components/pay/PayClient'
import PortalHomeView from '@/components/portal/PortalHomeView'
import PortalSignIn from '@/components/portal/PortalSignIn'
import OnlinePaymentsCard from '@/components/admin/OnlinePaymentsCard'
import InvoiceOnlinePayments from '@/components/billing/InvoiceOnlinePayments'
import type { PayPageView } from '@/lib/online-payments/public'
import CrewDayList, { type CrewDayVisit } from '@/app/crew/day/[token]/CrewDayList'
import CustomerMessagesSettings from '@/components/admin/CustomerMessagesSettings'
import CustomerMessagesCard from '@/components/customer/CustomerMessagesCard'
import { MESSAGE_KINDS, describeMessages, quietHoursPhrase, readCustomerMessageSettings, sampleMessages } from '@/lib/customer-messages'

const HARNESS_MESSAGE_SETTINGS = readCustomerMessageSettings({ visitReminder: true, visitWindow: 'between 8 AM and 5 PM', visitDone: true, invoiceReminder: true })
const HARNESS_MESSAGE_SAMPLES = sampleMessages(
  { name: 'Precision Maintenance', phone: '(850) 443-0000', email: 'office@precision.test', website: 'precision.test', addressLine: '12 Main St, Crawfordville, FL 32327' },
  HARNESS_MESSAGE_SETTINGS,
  '2026-11-11',
  'Quote'
)
const HARNESS_MESSAGES_VIEW = {
  settings: HARNESS_MESSAGE_SETTINGS,
  describe: describeMessages(HARNESS_MESSAGE_SETTINGS),
  quiet: quietHoursPhrase(HARNESS_MESSAGE_SETTINGS),
  blockers: ['The database needs an update before any email can go out (migration 202611120050).'],
  samples: Object.fromEntries(MESSAGE_KINDS.map((k) => [k, { subject: HARNESS_MESSAGE_SAMPLES[k].subject, html: HARNESS_MESSAGE_SAMPLES[k].html }])) as Record<(typeof MESSAGE_KINDS)[number], { subject: string; html: string }>,
}
import { HARNESS_CATCH_UP_JOBS, HARNESS_CATCH_UP_STUCK, HARNESS_VIEWER_ID } from '@/e2e/fixtures'

function GeneralSettingsHarness({ canEditBrand }: { canEditBrand: boolean }) {
  const [value, setValue] = useState<GeneralSettingsValues>({
    company_name: 'Harness Roofing & Exteriors',
    company_phone: '(555) 010-0100',
    company_email: 'office@example.test',
    company_address: '100 Main St\nSpringfield, ST 00000',
    brand_legal_name: 'Harness Roofing & Exteriors, LLC',
    brand_short_name: 'Harness',
    brand_website: 'example.test',
    brand_service_area: 'Springfield / Shelbyville, ST',
    timezone: DEFAULT_TIMEZONE,
    date_format: 'MM/DD/YYYY',
    currency: 'USD',
  })
  return (
    <div className="mx-auto max-w-2xl p-4">
      <h1 className="text-2xl font-bold mb-6" style={{ color: '#2c2c2a' }}>General Settings</h1>
      <GeneralSettingsCard value={value} onChange={(patch) => setValue((prev) => ({ ...prev, ...patch }))} canEditBrand={canEditBrand} saving={false} onSave={() => undefined} />
    </div>
  )
}

const HANDOFF_TARGET = 'https://crm.example.test/canvass'
const handoffDeps = (knocks: number, jobPhotos: number, reportPhotos: number, knocksNeedingAttention = 0): HandoffDeps => ({
  flush: async () => undefined,
  count: async () => ({ knocks, jobPhotos, reportPhotos, knocksNeedingAttention, photosUnreadable: false }),
})
const HANDOFF_PENDING = handoffDeps(3, 1, 1)
const HANDOFF_DONE = handoffDeps(0, 0, 0)
const HANDOFF_ATTENTION = handoffDeps(0, 0, 0, 2)

/** Customer portal (components/portal): a lawn customer with a visit, two invoices, a plan, a shared document, a card and a message. */
const HARNESS_PORTAL_COMPANY = { name: 'Precision Maintenance', phone: '850-443-9662', email: 'office@precision.test', logoHref: null }
const HARNESS_PORTAL_HOME = {
  customerName: 'Dana Whitfield',
  today: '2026-11-12',
  visits: { upcoming: [{ id: 'v1', date: '2026-11-17', service: 'Weekly lawn care', address: '2410 Crawfordville Hwy, Crawfordville FL', done: false }], recent: [{ id: 'v0', date: '2026-11-10', service: 'Weekly lawn care', address: null, done: true }] },
  invoices: [
    { id: 'i1', number: 'INV-26-00012', status: 'sent' as const, totalCents: 9500, balanceCents: 9500, issuedAt: '2026-11-10', dueAt: '2026-11-24' },
    { id: 'i2', number: 'INV-26-00009', status: 'paid' as const, totalCents: 9500, balanceCents: 0, issuedAt: '2026-10-10', dueAt: null },
  ],
  contracts: [{ id: 'c1', address: '2410 Crawfordville Hwy', totalCents: 420000, state: 'to_sign' as const, signUrl: '/contracts/sign/x', downloadUrl: null, date: '2026-11-09' }],
  documents: [{ id: 'd1', title: 'Service agreement with a rather long file name that must wrap on a phone.pdf', kind: 'document' as const, date: '2026-11-01' }],
  plans: [{ id: 'p1', name: 'Weekly lawn care', address: '2410 Crawfordville Hwy', status: 'active' as const, schedule: 'Weekly Apr 1 – Oct 31', price: '$95.00 per visit', nextVisit: '2026-11-17' }],
  card: { available: true, label: 'Visa •••• 4242', autopay: true, expired: false },
  messages: [{ id: 'm1', fromCustomer: false, body: 'See you Tuesday!', date: '2026-11-09T12:00:00Z' }],
}

/** Online payments pay page (components/pay/PayClient.tsx): a service invoice, part payments + save card allowed. */
const HARNESS_PAY_VIEW: PayPageView = {
  kind: 'invoice',
  state: 'pay',
  company: { name: 'Precision Maintenance', phone: '555-201-3344', email: 'office@precision.test', logoHref: null },
  customerName: 'Pat Doe',
  invoice: { number: 'INV-26-00012', totalCents: 9500, balanceCents: 9500, payableCents: 9500, processingCents: 0 },
  allowPartial: true,
  minPartialCents: 100,
  bankPayments: true,
  canSaveCard: true,
  consentText: 'I authorize Precision Maintenance to charge this card for my service invoices when they are sent, until I ask them to stop.',
  cardOnFile: null,
}

export default function Harness({ params }: { params: { screen: string } }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const [open, setOpen] = useState(true)

  switch (params.screen) {
    case 'force-paid':
      return open ? (
        <CompleteJobModal variant="collect" jobId="job-1" remainingCents={123456} canForce onClose={() => setOpen(false)} onConfirm={() => setOpen(false)} />
      ) : <p>closed</p>
    case 'sale-credit':
      return (
        <ContractModal
          isOpen
          onClose={() => undefined}
          opportunityId="opp-1"
          customerName="Pat Customer"
          customerEmail="pat@example.test"
          customerPhone="7045550100"
          projectAddress="12 Elm Street, Concord NC 28025"
          projectCost={16325}
        />
      )
    case 'checkups':
      return (
        <div className="p-3">
          <CheckupList today="2026-11-09" sections={[{ id: 'overdue', title: 'Due now', empty: 'Nothing due right now.', rows: HARNESS_CHECKUPS as never }, { id: 'soon', title: 'Coming up', empty: 'Nothing coming up.', rows: [] }]} />
        </div>
      )
    case 'needs-you':
      return <div className="p-3"><NeedsYouList report={HARNESS_NEEDS_YOU as never} canFixPayPlans /></div>
    case 'job-documents':
      return (
        <div className="p-3">
          <JobDocumentsBanner jobId="job-1" jobNumber="26-0042" showOrderSheet materialsStatus="not_ordered" onMarkMaterialsOrdered={() => undefined} />
        </div>
      )
    case 'materials-costs':
      return <div className="p-3"><JobMaterialsCard jobId="job-1" userRole="admin" title="Materials" /></div>
    case 'supplier-orders':
      return <div className="p-3"><SupplierOrdersCard jobId="job-1" /></div>
    case 'pay-banners': {
      const summary = { payments: [], collected_cents: 1632500, collected_dollars: 16325, sale_amount_cents: 1632500, sale_amount_dollars: 16325, remaining_cents: 0, remaining_dollars: 0, payment_count: 3, paid_in_full: true, paid_by_payments: true } as never
      return (
        <div className="p-3">
          <JobReadyToPayBanner status="complete" paymentSummary={summary} saleAmount={16325} canViewBilling onMarkCollected={() => undefined} onMarkJobComplete={() => undefined} />
          <JobPayrollSentBanner jobId="job-1" status="complete" payrollSentAt={null} paymentSummary={summary} saleAmount={16325} canViewBilling onUpdated={() => undefined} />
        </div>
      )
    }
    case 'suppliers-admin':
      return <SuppliersClient />
    case 'email-blasts':
      return <EmailBlastsPage />
    case 'contract-signing':
      return <ContractSigningForm contract={HARNESS_CONTRACT as never} token="tok" brand={DEFAULT_DOCUMENT_BRAND} cancellationNotice={noticeOfCancellation('2026-11-06T15:00:00Z', DEFAULT_DOCUMENT_BRAND)} />
    case 'change-order-signing':
      return <ChangeOrderSigningForm changeOrder={{ co_number: 'CO-1', description: 'Replace 3 sheets of rotten decking at the rear slope. Add 40 LF of drip edge.', customer_print_name: 'Pat Customer', updated_total: 16825 }} token="tok" />
    case 'crew-capture':
      return <CrewPhotoCapture token="tok" tradeLabel="Roofing" addressText="12 Elm Street, Concord NC 28025" jobNumber="26-0042" initialCounts={{ final_front: 1 }} brand={DEFAULT_DOCUMENT_BRAND} />
    case 'payroll-attribution':
      return (
        <div className="p-3">
          <PayrollAttributionEditor opportunityId="opp-1" canEdit initial={{ opportunity_id: 'opp-1', setter_user_id: 'u2', closer_user_id: 'u1', setter_name: 'Stevo Potts', closer_name: 'Nathan Hall' }} />
        </div>
      )
    case 'projects':
      return <ProjectsView {...(HARNESS_PROJECTS as unknown as React.ComponentProps<typeof ProjectsView>)} />
    case 'incentives':
      return <IncentivesClient {...(HARNESS_INCENTIVES as unknown as React.ComponentProps<typeof IncentivesClient>)} />
    case 'inside-sales':
      return <InsideSalesPage />
    case 'ops-schedule':
      return <InstallScheduleClient />
    case 'referral-partners':
      return <ReferralPartnersClient types={[{ id: 't1', name: 'Realtor' }, { id: 't2', name: 'Adjuster' }]} canManage />
    case 'ops-dashboard':
      return <OpsDashboardView {...(HARNESS_OPS_DASHBOARD as unknown as React.ComponentProps<typeof OpsDashboardView>)} />
    case 'ops-board':
      return <OpsClient initialJobs={HARNESS_OPS_JOBS as never} orgId="org-1" canViewProfitability />
    case 'catch-up-board':
      return <OpsClient initialJobs={HARNESS_CATCH_UP_JOBS as never} orgId="org-1" canViewProfitability={false} catchUp={{ enabled: true, stuckDays: 7, viewerId: HARNESS_VIEWER_ID }} />
    case 'catch-up-job':
    case 'catch-up-job-v2': {
      const v2 = params.screen === 'catch-up-job-v2'
      return (
        <JobDetailClient
          v2={v2}
          initialJob={(v2 ? HARNESS_JOB_0037 : HARNESS_JOB) as never}
          catchUp={HARNESS_CATCH_UP_STUCK as never}
          paymentMethod="finance"
          userRole="operations"
          canViewProfitability={false}
          canEditJobs
          canDeleteProductionJob={false}
          canViewJobBilling={false}
          canEditPayrollAttribution={false}
          canEditFinancialSource={false}
          financialSourceProposalOptions={[]}
          changeOrdersSection={null}
        />
      )
    }
    case 'catch-up-settings':
      return (
        <div className="mx-auto max-w-2xl p-4">
          <JobCatchUpSettingsCard initial={{ enabled: false, stuckDays: 7, canEdit: true }} />
        </div>
      )
    case 'org-features':
      return (
        <div className="mx-auto max-w-2xl p-4">
          <OrgFeaturesCard initial={{ canvassing: false, insurance: false, roofMeasure: true, incentives: false, stormAlerts: false, squaresPricing: true, servicePlans: true, timeTracking: false, hourlyBilling: false, onlinePayments: false, customerMessages: false, customerPortal: false }} />
        </div>
      )
    case 'org-profile':
      return (
        <div className="mx-auto max-w-2xl p-4">
          <OrgProfileCard
            current={{ id: 'roofing', label: INDUSTRY_PROFILES.roofing.label, description: INDUSTRY_PROFILES.roofing.description }}
            profiles={INDUSTRY_PROFILE_IDS.map((id) => ({ id, label: INDUSTRY_PROFILES[id].label, description: INDUSTRY_PROFILES[id].description }))}
          />
        </div>
      )
    case 'sales-tax':
      return (
        <div className="mx-auto max-w-2xl p-4">
          <SalesTaxCard
            initial={{
              enabled: true,
              rates: [
                { id: 'state', name: 'State', percent: 6, active: true },
                { id: 'county', name: 'Leon County surtax', percent: 1.5, active: true },
              ],
              defaultRateIds: ['state', 'county'],
            }}
          />
        </div>
      )
    case 'tax-exemption':
      return (
        <div className="mx-auto max-w-2xl p-4">
          <TaxExemptionCard
            customerId="00000000-0000-0000-0000-000000000001"
            initial={{ exempt: true, reason: 'Church', certificateNumber: 'FL-85-123', documentId: null }}
            documents={[{ id: '00000000-0000-0000-0000-000000000002', label: 'Exemption certificate.pdf' }]}
          />
        </div>
      )
    case 'job-page':
      return (
        <JobDetailClient
          initialJob={HARNESS_JOB as never}
          paymentMethod="finance"
          userRole="admin"
          canViewReportFinancials
          canViewProfitability
          canDeleteProductionJob={false}
          canViewJobBilling
          canEditPayrollAttribution
          canEditFinancialSource={false}
          isSuperAdmin
          financialSourceProposalOptions={[]}
          changeOrdersSection={null}
        />
      )
    case 'job-v2-ops':
    case 'job-v2-owner': {
      const owner = params.screen === 'job-v2-owner'
      return (
        <JobDetailClient
          v2
          initialJob={HARNESS_JOB_0037 as never}
          paymentMethod="finance"
          userRole={owner ? 'admin' : 'operations'}
          canViewReportFinancials={owner}
          canViewProfitability
          canEditJobs
          canDeleteProductionJob={false}
          canViewJobBilling
          canEditPayrollAttribution={owner}
          canEditFinancialSource={false}
          isSuperAdmin={owner}
          financialSourceProposalOptions={[]}
          changeOrdersSection={null}
        />
      )
    }
    case 'announcement-banner':
      return (
        <div>
          <div className="bg-gray-800 p-4 text-white">Site header</div>
          <AnnouncementBanner />
          <div className="p-4"><button type="button" className="min-h-[44px] rounded-lg bg-indigo-700 px-4 text-white">Page main action</button></div>
        </div>
      )
    case 'announcements-admin':
      return <AnnouncementsClient />
    case 'reports-home':
      return <ReportsPage />
    case 'reports-explore':
      return <ExploreClient />
    case 'job-sheets':
      return <JobSheetsEditor initialSheet={HARNESS_RUN_SHEET as never} canEdit scope={null} coverage={{} as never} showOrder={false} />
    case 'dashboard':
      return <DashboardClient profile={HARNESS_DASHBOARD.profile} stats={HARNESS_DASHBOARD.stats} progress={HARNESS_DASHBOARD.progress} pendingPrompts={[]} upcomingAppointments={[]} recentActivities={[]} settings={{}} />
    case 'whats-new': {
      // Every role group, as the real page renders it (same component + same screenshot table).
      return (
        <div>
          {ROLE_GROUPS.map((g) => (
            <section key={g} data-group={g}>
              <WhatsNewView title="What's new" group={g} lines={['An example announcement line.']} shots={WHATS_NEW_SHOTS[g] ?? []} />
            </section>
          ))}
        </div>
      )
    }
    case 'nav':
      return (
        <div className="min-h-screen bg-surface-subtle">
          <Nav />
          <main className="p-4"><h1 className="text-ui-xl font-bold text-ink">Page content</h1></main>
        </div>
      )
    case 'settings-hub':
      return <div className="mx-auto max-w-6xl p-4"><h1 className="text-ui-xl font-bold text-ink">Settings</h1><SettingsHub groups={visibleSettingsGroups({ canCost: true, canPayroll: true, canSuperuser: true, canWorkAreas: true })} /></div>
    case 'today':
      return (
        <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
          <h1 className="text-ui-xl font-bold text-ink">Today</h1>
          <div className="grid gap-4 md:grid-cols-2">{HARNESS_QUEUES.map((q) => <QueueCard key={q.id} queue={q} />)}</div>
          <KpiTiles tiles={[{ label: 'Sits this week', value: 4 }, { label: 'Sales this week', value: 2 }]} />
        </div>
      )
    case 'customer-file':
      return (
        <div className="min-h-screen bg-surface-subtle">
          <FileHeader ctx={HARNESS_FILE_CTX as never} />
          <FileTabs base="/c/c1/d/d2" tabs={HARNESS_FILE_CTX.tabs as never} />
          <main className="mx-auto max-w-7xl p-4"><ThreadPanel customerId="c1" dealId="d2" variant="page" /></main>
        </div>
      )
    case 'work-orders':
      return <WorkOrdersClient initialWorkOrders={HARNESS_WORK_ORDERS as never} />
    case 'customers':
      return <div className="mx-auto max-w-7xl p-4"><CustomersPageClient customers={HARNESS_CUSTOMERS} query="" /></div>
    case 'proposals':
      return <ProposalsPage />
    case 'leads':
      return <LeadsClient profile={{ id: 'u1', org_id: 'org-1', role: 'admin' }} canViewInbound campaigns={[{ id: 'cm1', name: 'Fall storm' }]} leadSources={[{ id: 'ls1', name: 'Website' }]} users={[{ id: 'u1', full_name: 'Jordan Setter' }]} />
    case 'job-profit':
      return <div className="p-4"><JobProfitTable rows={HARNESS_PROFIT_ROWS} /></div>
    case 'opportunities':
      return <OpportunitiesPage />
    case 'appointments':
      return <div className="mx-auto max-w-7xl p-4"><AppointmentsList /></div>
    case 'ui-kit':
      return <UiKitHarness />
    case 'default-plans':
      return <div className="p-3"><DefaultPlansCard /></div>
    case 'my-pay':
      return <div className="mx-auto max-w-xl p-4"><MyPayClient /></div>
    case 'admin-settings':
      return <GeneralSettingsHarness canEditBrand />
    case 'admin-settings-readonly':
      return <GeneralSettingsHarness canEditBrand={false} />
    case 'move-from-jobber':
    case 'move-from-jobber-done':
      return <div className="mx-auto max-w-3xl p-4"><h1 className="text-ui-xl font-bold text-ink">Move from Jobber</h1><MoveFromJobber /></div>
    case 'custom-fields-admin':
      return <div className="mx-auto max-w-3xl p-4"><h1 className="text-ui-xl font-bold text-ink">Custom fields</h1><CustomFieldsClient /></div>
    case 'customer-records': {
      const defs = HARNESS_CUSTOM_FIELDS.definitions as CustomFieldDefinition[]
      return (
        <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
          <h1 className="text-ui-xl font-bold text-ink">Gulf Coast Property Group</h1>
          <CustomFieldsCard entity="customer" recordId="cust-1" definitions={defs} initialValues={{ 'cf-gate': 'Dana (accounts payable)', 'cf-terms': 'Net 30' }} canEdit title="Customer details" />
          <PropertiesCard customerId="cust-1" initial={HARNESS_PROPERTIES as Property[]} ready canEdit accessNotes propertyFields={defs.filter((d) => d.entity === 'property')} />
          <CustomerDocumentsCard customerId="cust-1" initial={HARNESS_CUSTOMER_DOCUMENTS} canUpload properties={[{ id: 'prop-1', name: 'Main office · 2410 Crawfordville Hwy' }, { id: 'prop-2', name: 'Rental on Oak · 88 Oak Ridge Rd' }]} />
        </div>
      )
    }
    case 'service-plans':
      return (
        <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
          <h1 className="text-ui-xl font-bold text-ink">Gulf Coast Property Group</h1>
          <ServicePlansCard customerId="cust-1" />
        </div>
      )
    case 'visits-board':
      return <VisitsBoard />
    case 'ready-to-bill':
      return <ReadyToBill />
    case 'hours-to-bill':
      return <HoursToBill />
    case 'job-hourly':
      return <div className="mx-auto max-w-md p-4"><JobHourlyCard jobId="dddddddd-0000-4000-8000-000000000001" /></div>
    case 'customer-messages-settings':
      return <div className="mx-auto max-w-3xl p-4"><CustomerMessagesSettings initial={HARNESS_MESSAGES_VIEW} /></div>
    case 'customer-messages-card':
      return (
        <div className="mx-auto max-w-2xl p-4">
          <CustomerMessagesCard
            customerId="c1"
            canEdit
            initial={{
              off: false,
              offAt: null,
              offBy: null,
              email: 'jane.smith.long.address@example.com',
              suppressed: null,
              recent: [
                { id: 'm1', kind: 'visit_reminder', status: 'sent', at: '2026-11-10T13:30:00Z', reason: null, subject: 'Reminder: we’ll see you tomorrow' },
                { id: 'm2', kind: 'invoice_reminder', status: 'skipped', at: '2026-11-09T13:30:00Z', reason: 'daily_limit', subject: null },
              ],
            }}
          />
        </div>
      )
    case 'crew-day-on-the-way':
      return <CrewDayList token="harness-token-harness-token-harness-4" crewName="Green Team" companyName="Precision Maintenance" today="2026-11-10" visits={HARNESS_CREW_DAY as CrewDayVisit[]} onTheWay />
    case 'hourly-settings':
      return <div className="mx-auto max-w-md p-4"><HourlyBillingSettingsCard /></div>
    case 'customer-invoices':
      return <div className="mx-auto max-w-2xl p-4"><CustomerInvoicesCard customerId="c1" /></div>
    case 'portal-signin':
      return <PortalSignIn company={HARNESS_PORTAL_COMPANY} />
    case 'portal-home':
      return <PortalHomeView company={HARNESS_PORTAL_COMPANY} home={HARNESS_PORTAL_HOME} payOnline />
    case 'pay-page':
      return <PayClient token="harness-pay-token-harness-pay-token-harness" view={HARNESS_PAY_VIEW} returned={false} />
    case 'pay-page-paid':
      return <PayClient token="harness-pay-token-harness-pay-token-harness" view={{ ...HARNESS_PAY_VIEW, state: 'paid' }} returned />
    case 'save-card-page':
      return <PayClient token="harness-pay-token-harness-pay-token-harness" view={{ ...HARNESS_PAY_VIEW, kind: 'save_card', state: 'save_card', invoice: null, cardOnFile: 'Visa •••• 4242' }} returned={false} />
    case 'online-payments-settings':
      return <div className="mx-auto max-w-2xl p-4"><OnlinePaymentsCard /></div>
    case 'invoice-online':
      return (
        <div className="mx-auto max-w-2xl p-4">
          <InvoiceOnlinePayments
            invoiceId="inv-1"
            owed
            online={{ featureOn: true, ready: true, attempts: [
              { id: 'a1', kind: 'autopay', status: 'failed', label: 'Automatic payment didn’t go through (Visa •••• 4242)', amountCents: 9500, refundedCents: 0, at: '2026-11-10T12:00:00Z', note: 'Your card has insufficient funds.' },
              { id: 'a2', kind: 'checkout', status: 'processing', label: 'Bank payment processing (bank •••• 6789)', amountCents: 9500, refundedCents: 0, at: '2026-11-11T12:00:00Z', note: null },
            ] }}
          />
        </div>
      )
    case 'crew-day':
      return <CrewDayList token="harness-token-harness-token-harness-1" crewName="Green Team" companyName="Precision Maintenance" today="2026-11-10" visits={HARNESS_CREW_DAY as CrewDayVisit[]} />
    case 'crew-day-clock':
      return <CrewDayList token="harness-token-harness-token-harness-2" crewName="Green Team" companyName="Precision Maintenance" today="2026-11-10" visits={HARNESS_CREW_DAY as CrewDayVisit[]} clock={HARNESS_CLOCK_STATE as unknown as ClockState} />
    case 'crew-day-clocked-in':
      return <CrewDayList token="harness-token-harness-token-harness-3" crewName="Green Team" companyName="Precision Maintenance" today="2026-11-10" visits={HARNESS_CREW_DAY as CrewDayVisit[]} clock={HARNESS_CLOCK_STATE_IN as unknown as ClockState} />
    case 'job-clock':
      return <div className="mx-auto max-w-md p-4"><JobClockCard jobId="dddddddd-0000-4000-8000-000000000001" jobLabel="job 26-0141" /></div>
    case 'time-week':
      return (
        <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
          <TimeWeekClient initial={HARNESS_TIME_WEEK as unknown as TimeWeek} />
          <TimeClockSettingsCard />
        </div>
      )
    case 'crew-time-setup':
      return <div className="mx-auto max-w-lg p-4"><CrewTimeSetup subId="s1" /></div>
    case 'plan-templates':
      return <div className="mx-auto max-w-2xl p-4"><ServicePlanTemplatesCard /></div>
    case 'customer-records-plain':
      // A one-home customer at a company that doesn't use properties: only the small add links.
      return (
        <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
          <h1 className="text-ui-xl font-bold text-ink">Pat Customer</h1>
          <CustomFieldsCard entity="customer" recordId="cust-2" definitions={[]} initialValues={{}} canEdit />
          <PropertiesCard customerId="cust-2" initial={[{ ...(HARNESS_PROPERTIES[1] as Property), label: null, customer_id: 'cust-2' }]} ready canEdit accessNotes propertyFields={[]} />
          <CustomerDocumentsCard customerId="cust-2" initial={[]} canUpload properties={[]} />
        </div>
      )
    case 'job-setup':
      return <div className="mx-auto max-w-3xl p-4"><h1 className="text-ui-xl font-bold text-ink">Job setup</h1><JobSetupClient /></div>
    case 'pay-week':
      return <div className="mx-auto max-w-3xl p-4"><PayWeekClient /></div>
    case 'moved-host-pending':
      return <div className="h-screen bg-gray-100"><MovedHostNotice target={HANDOFF_TARGET} deps={HANDOFF_PENDING} /></div>
    case 'moved-host-attention':
      return <div className="h-screen bg-gray-100"><MovedHostNotice target={HANDOFF_TARGET} deps={HANDOFF_ATTENTION} /></div>
    case 'moved-host-ready':
      return <div className="h-screen bg-gray-100"><MovedHostNotice target={HANDOFF_TARGET} deps={HANDOFF_DONE} /></div>
    default:
      notFound()
  }
}
