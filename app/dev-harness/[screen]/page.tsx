'use client'

/**
 * Mobile-pass harness: renders client screens with no login so Playwright (e2e/mobile.spec.ts) can mock
 * their /api calls and check them at phone widths. Dev only — it 404s in production builds.
 */
import { notFound } from 'next/navigation'
import { useState } from 'react'

import AreaMeasureClient from '@/components/area-measure/AreaMeasureClient'
import YardMeasureCard from '@/components/area-measure/YardMeasureCard'
import { HARNESS_YARD_ROWS } from '@/e2e/fixtures'
import CompleteJobModal from '@/components/ops/CompleteJobModal'
import JobDocumentsBanner from '@/components/ops/JobDocumentsBanner'
import JobMaterialsCard from '@/components/ops/JobMaterialsCard'
import NeedsYouList from '@/components/ops/NeedsYouList'
import CheckupList from '@/components/checkups/CheckupList'
import MoveFromJobber from '@/components/jobber-import/MoveFromJobber'
import MoveSignedDocuments from '@/components/signed-import/MoveSignedDocuments'
import { HARNESS_CHECKUPS } from '@/e2e/fixtures'
import { HARNESS_CREW_DAY, HARNESS_CREW_DAY_MONEY, HARNESS_CLOCK_STATE, HARNESS_CLOCK_STATE_IN, HARNESS_TIME_WEEK } from '@/e2e/fixtures'
import JobClockCard from '@/components/time/JobClockCard'
import TimeWeekClient from '@/components/time/TimeWeekClient'
import TimeClockSettingsCard from '@/components/time/TimeClockSettingsCard'
import CrewTimeSetup from '@/components/time/CrewTimeSetup'
import type { ClockState } from '@/components/time/useClock'
import type { TimeWeek } from '@/lib/time-tracking-db'
import WhatsNewView from '@/components/WhatsNewView'
import { ROLE_GROUPS } from '@/lib/announcements'
import { WHATS_NEW_SHOTS } from '@/lib/whats-new-shots'
import ConnectAiCard from '@/components/ai-connector/ConnectAiCard'
import SupplierOrdersCard from '@/components/ops/SupplierOrdersCard'
import PurchaseOrdersCard from '@/components/ops/PurchaseOrdersCard'
import JobReadyToPayBanner from '@/components/ops/JobReadyToPayBanner'
import JobPaymentsCard from '@/components/ops/JobPaymentsCard'
import SuppliersClient from '@/app/admin/suppliers/SuppliersClient'
import ContractSigningForm from '@/app/contracts/sign/[token]/CustomerSigningForm'
import ChangeOrderSigningForm from '@/app/change-orders/sign/[token]/CustomerSigningForm'
import SigningStatus from '@/components/signing/SigningStatus'
import SignerFlow from '@/components/signing/SignerFlow'
import { esignDisclosure } from '@/lib/signing/consent'
import CrewPhotoCapture from '@/app/crew/[token]/CrewPhotoCapture'
import JobProjectTools from '@/components/project-tools/JobProjectTools'
import SelectionClient from '@/components/selections/SelectionClient'
import { HARNESS_PUBLIC_SELECTION } from '@/e2e/fixtures'
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
import ProposalBuilderPage from '@/app/proposals/builder/page'
import LeadsClient from '@/app/leads/LeadsClient'
import OpportunitiesPage from '@/app/opportunities/page'
import JobDetailClient from '@/app/ops/jobs/[id]/JobDetailClient'
import { HARNESS_JOB, HARNESS_JOB_0037 } from '@/e2e/fixtures'
import AnnouncementBanner from '@/components/AnnouncementBanner'
import AnnouncementsClient from '@/app/admin/announcements/AnnouncementsClient'
import BonusApprovalClient from '@/app/admin/bonuses/BonusApprovalClient'
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
import SigningSettingsCard from '@/components/admin/SigningSettingsCard'
import CheckupSettingsCard from '@/components/admin/CheckupSettingsCard'
import OrgFeaturesCard from '@/components/admin/OrgFeaturesCard'
import OrgProfileCard from '@/components/admin/OrgProfileCard'
import { INDUSTRY_PROFILE_IDS, INDUSTRY_PROFILES } from '@/lib/industry-profiles'
import SalesTaxCard from '@/components/admin/SalesTaxCard'
import TaxExemptionCard from '@/components/customer/TaxExemptionCard'
import PriceListCard from '@/components/customer/PriceListCard'
import ServicePlanTemplatesCard from '@/components/service-plans/ServicePlanTemplatesCard'
import ServicePlansCard from '@/components/service-plans/ServicePlansCard'
import VisitsBoard from '@/components/service-plans/VisitsBoard'
import ReadyToBill from '@/components/billing/ReadyToBill'
import HoursToBill from '@/components/billing/HoursToBill'
import JobHourlyCard from '@/components/billing/JobHourlyCard'
import HourlyBillingSettingsCard from '@/components/billing/HourlyBillingSettingsCard'
import CrewIncentivesSettingsCard from '@/components/admin/CrewIncentivesSettingsCard'
import CrewScoreboardCard from '@/components/crew/CrewScoreboardCard'
import { HARNESS_CREW_SCOREBOARD } from '@/e2e/fixtures'
import CustomerInvoicesCard from '@/components/billing/CustomerInvoicesCard'
import PayClient from '@/components/pay/PayClient'
import PortalHomeView from '@/components/portal/PortalHomeView'
import PortalSignIn from '@/components/portal/PortalSignIn'
import OnlinePaymentsCard from '@/components/admin/OnlinePaymentsCard'
import QuickBooksCard from '@/components/admin/QuickBooksCard'
import QuickBooksMappingCard from '@/components/admin/QuickBooksMappingCard'
import QuickBooksBackfillCard from '@/components/admin/QuickBooksBackfillCard'
import QuickBooksSetup from '@/components/admin/QuickBooksSetup'
import QuickBooksActivityCard from '@/components/admin/QuickBooksActivityCard'
import QuoteApprovalCard from '@/components/admin/QuoteApprovalCard'
import QuoteClient from '@/components/quotes/QuoteClient'
import QuoteLinkCard from '@/components/quotes/QuoteLinkCard'
import type { QuoteView } from '@/lib/quotes/load'
import InvoiceOnlinePayments from '@/components/billing/InvoiceOnlinePayments'
import type { PayPageView } from '@/lib/online-payments/public'
import CrewDayList, { type CrewDayVisit } from '@/app/crew/day/[token]/CrewDayList'
import CustomerMessagesSettings from '@/components/admin/CustomerMessagesSettings'
import TextingSettings from '@/components/admin/TextingSettings'
import { TextCustomerDialog } from '@/components/customer/TextCustomer'
import CustomerMessagesCard from '@/components/customer/CustomerMessagesCard'
import LeadRoutingSettings from '@/components/admin/LeadRoutingSettings'
import LeadFormWithReferral from '@/components/LeadFormWithReferral'
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
  texting: true,
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
    { id: 'i1', jobId: null, number: 'INV-26-00012', status: 'sent' as const, totalCents: 9500, balanceCents: 9500, issuedAt: '2026-11-10', dueAt: '2026-11-24' },
    { id: 'i2', jobId: null, number: 'INV-26-00009', status: 'paid' as const, totalCents: 9500, balanceCents: 0, issuedAt: '2026-10-10', dueAt: null },
  ],
  contracts: [{ id: 'c1', address: '2410 Crawfordville Hwy', totalCents: 420000, state: 'to_sign' as const, signUrl: '/contracts/sign/x', downloadUrl: null, date: '2026-11-09' }],
  documents: [{ id: 'd1', title: 'Service agreement with a rather long file name that must wrap on a phone.pdf', kind: 'document' as const, date: '2026-11-01' }],
  paperwork: [] as Array<{ id: string; title: string; href: string; date: string }>,
  jobs: [] as PortalHomeJobs,
  checkups: [] as Array<{ id: string; title: string; when: string; booked: boolean }>,
  plans: [{ id: 'p1', name: 'Weekly lawn care', address: '2410 Crawfordville Hwy', status: 'active' as const, schedule: 'Weekly Apr 1 – Oct 31', price: '$95.00 per visit', nextVisit: '2026-11-17' }],
  card: { available: true, label: 'Visa •••• 4242', autopay: true, expired: false },
  messages: [{ id: 'm1', fromCustomer: false, body: 'See you Tuesday!', date: '2026-11-09T12:00:00Z' }],
}

/** A roofing customer: job with progress, two crews (one close, one a week out), a balance, a checkup, a signed change order. */
type PortalHomeJobs = import('@/lib/portal/job-progress').PortalJob[]
const HARNESS_PORTAL_ROOFING_HOME = {
  ...HARNESS_PORTAL_HOME,
  customerName: 'Marcus Reed',
  visits: { upcoming: [], recent: [] },
  invoices: [{ id: 'i7', jobId: 'j1', number: 'INV-26-00031', status: 'sent' as const, totalCents: 1632500, balanceCents: 816250, issuedAt: '2026-11-10', dueAt: '2026-11-24' }],
  contracts: [],
  plans: [],
  card: null,
  documents: [{ id: 'p9', title: 'Front', kind: 'photo' as const, date: '2026-11-11' }],
  paperwork: [{ id: 'co1', title: 'Change order CO-001', href: '/api/files/signed/change-order/x', date: '2026-11-05' }, { id: 'r1', title: 'Inspection report', href: '/r/x', date: '2026-10-20' }],
  checkups: [{ id: 'k1', title: 'Checkup', when: '2027-05-14', booked: false }],
  jobs: [
    {
      id: 'j1',
      address: '1484 Maple Ridge Dr, Concord NC',
      quiet: false,
      stages: [
        { key: 'sold' as const, label: 'Signed', state: 'done' as const },
        { key: 'materials' as const, label: 'Materials ordered', state: 'done' as const },
        { key: 'scheduled' as const, label: 'Install scheduled', state: 'done' as const },
        { key: 'installed' as const, label: 'Installed', state: 'current' as const },
        { key: 'complete' as const, label: 'Complete', state: 'todo' as const },
      ],
      installs: [
        { label: 'Roof', when: { kind: 'day' as const, ymd: '2026-11-14' }, done: false, inProgress: false },
        { label: 'Gutters', when: { kind: 'week' as const, ymd: '2026-11-23' }, done: false, inProgress: false },
      ],
      money: { totalCents: 1632500, paidCents: 816250, balanceCents: 816250, paidInFull: false, financedThrough: null, contactAboutBalance: false },
    },
  ],
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

/** Quote approval customer page (components/quotes/QuoteClient.tsx): a lawn quote with two options, one ticked to start. */
const HARNESS_QUOTE_VIEW: QuoteView = {
  state: 'open',
  company: { name: 'Precision Maintenance', phone: '555-201-3344', email: 'office@precision.test', logoHref: null },
  customerName: 'Pat Doe',
  address: '12 Maple Ct',
  title: 'Spring lawn and beds',
  number: 'P-00042',
  scope: 'Weekly mowing, edging and bed cleanup.',
  required: [{ id: 'r1', name: 'Mowing, edging and blowing (weekly)', description: 'April to October', cents: 120000 }],
  hiddenRequiredCents: 0,
  options: [
    { id: 'o1', name: 'Mulch refresh (6 yards)', description: 'Hardwood mulch, spread by hand', cents: 48000, defaultOn: true },
    { id: 'o2', name: 'Driveway pressure wash', description: '', cents: 22000, defaultOn: false },
  ],
  lines: [
    { id: 'r1', line_total: 1200, unit_price: 1200, unit: 'each', price_type: null, taxable: null },
    { id: 'o1', line_total: 480, unit_price: 480, unit: 'each', price_type: null, taxable: null, is_optional: true, optional_default_on: true },
    { id: 'o2', line_total: 220, unit_price: 220, unit: 'each', price_type: null, taxable: null, is_optional: true, optional_default_on: false },
  ],
  tax: { kind: 'legacy', percent: 7 },
  discountPercent: 0,
  discountAmount: 0,
  depositMode: 'percent',
  depositPercent: 25,
  depositFixedCents: 0,
  terms: 'Work is scheduled within two weeks of approval. Weather may move a visit.',
  fingerprint: 'harness0',
  approval: null,
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
    case 'purchase-orders':
      return <div className="p-3"><PurchaseOrdersCard jobId="job-1" /></div>
    case 'job-payments':
      return <div className="p-3"><JobPaymentsCard jobId="job-1" saleAmount={16325} /></div>
    case 'pay-banners': {
      const summary = { payments: [], collected_cents: 1632500, collected_dollars: 16325, sale_amount_cents: 1632500, sale_amount_dollars: 16325, remaining_cents: 0, remaining_dollars: 0, payment_count: 3, paid_in_full: true, paid_by_payments: true } as never
      return (
        <div className="p-3">
          <JobReadyToPayBanner status="complete" paymentSummary={summary} saleAmount={16325} canViewBilling onMarkCollected={() => undefined} onMarkJobComplete={() => undefined} />
        </div>
      )
    }
    case 'suppliers-admin':
      return <SuppliersClient />
    case 'email-blasts':
      return <EmailBlastsPage />
    case 'contract-signing':
      return <ContractSigningForm contract={HARNESS_CONTRACT as never} token="tok" brand={DEFAULT_DOCUMENT_BRAND} cancellationNotice={noticeOfCancellation('2026-11-06T15:00:00Z', DEFAULT_DOCUMENT_BRAND)} />
    case 'signer-flow':
      return (
        <SignerFlow
          token="tok" title="Lease agreement" companyName="Acme Roofing" signerName="Olive Owner" roleLabel="Owner" waitingFor={null} alreadySigned={false} completed={false} declineEnabled
          consent={esignDisclosure({ name: 'Acme Roofing', phone: '555-0100', email: 'office@acme.test' })}
          fields={[
            { id: 'f1', roleKey: 'owner', kind: 'signature', page: 0, x: 0.1, y: 0.3, w: 0.4, h: 0.06, required: true, mine: true, roleLabel: 'Owner' },
            { id: 'f2', roleKey: 'owner', kind: 'date', page: 0, x: 0.6, y: 0.3, w: 0.25, h: 0.04, required: true, mine: true, roleLabel: 'Owner' },
            { id: 'f3', roleKey: 'tenant', kind: 'signature', page: 0, x: 0.1, y: 0.5, w: 0.4, h: 0.06, required: true, mine: false, roleLabel: 'Tenant' },
          ]}
        />
      )
    case 'change-order-signing':
      return <ChangeOrderSigningForm changeOrder={{ co_number: 'CO-1', description: 'Replace 3 sheets of rotten decking at the rear slope. Add 40 LF of drip edge.', customer_print_name: 'Pat Customer', updated_total: 16825 }} token="tok" />
    case 'change-order-signing-consent':
      return <ChangeOrderSigningForm changeOrder={{ co_number: 'CO-1', description: 'Replace 3 sheets of rotten decking at the rear slope.', customer_print_name: 'Pat Customer', updated_total: 16825 }} token="tok" consent={esignDisclosure({ name: 'Acme Roofing', phone: '555-0100', email: 'office@acme.test' })} declineEnabled companyName="Acme Roofing" />
    case 'signing-status':
      return (
        <div className="p-3">
          <SigningStatus kind="change-order" id="co-1" />
        </div>
      )
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
    case 'signing-settings':
      return (
        <div className="mx-auto max-w-2xl p-4">
          <SigningSettingsCard />
        </div>
      )
    case 'checkup-settings':
      return (
        <div className="mx-auto max-w-2xl p-4">
          <CheckupSettingsCard
            initial={{ enabled: false, inspectionMonths: [6, 12], touchEveryMonths: 12, assigneeUserId: 'u-nathan', canEdit: true }}
            users={[{ id: 'u-nathan', name: 'Nathan Hall' }, { id: 'u-andrew', name: 'Andrew Waltz' }]}
          />
        </div>
      )
    case 'org-features':
      return (
        <div className="mx-auto max-w-2xl p-4">
          <OrgFeaturesCard initial={{ canvassing: false, insurance: false, roofMeasure: true, incentives: false, stormAlerts: false, squaresPricing: true, servicePlans: true, timeTracking: false, hourlyBilling: false, projectTools: false, onlinePayments: false, quickbooks: false, customerMessages: false, texting: false, aiConnector: false, aiConnectorWrites: false, customerPortal: false, quoteApproval: false, areaMeasure: false }} />
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
    case 'price-list':
      return (
        <div className="mx-auto max-w-2xl p-4">
          <PriceListCard
            customerId="00000000-0000-0000-0000-000000000001"
            lists={[
              { id: '00000000-0000-0000-0000-0000000000a1', name: 'Homeowner', is_default: true },
              { id: '00000000-0000-0000-0000-0000000000a2', name: 'Builder', is_default: false },
            ]}
            initialListId="00000000-0000-0000-0000-0000000000a2"
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
    case 'bonuses':
      return <div className="min-h-screen bg-surface-subtle"><main className="mx-auto max-w-3xl px-4 py-4"><BonusApprovalClient isFullAdmin /></main></div>
    case 'dashboard':
      return <DashboardClient profile={HARNESS_DASHBOARD.profile} stats={HARNESS_DASHBOARD.stats} progress={HARNESS_DASHBOARD.progress} pendingPrompts={[]} settings={{}} />
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
    case 'connect-ai':
      return <div className="mx-auto max-w-3xl p-4"><ConnectAiCard address="https://crm.example.com/mcp" companyName="Example Roofing" /></div>
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
    case 'proposal-builder':
      return <ProposalBuilderPage />
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
    case 'project-tools-money':
      return <div className="mx-auto max-w-xl p-3"><JobProjectTools part="money" jobId="job-1" canEdit isOwner /></div>
    case 'project-tools-crews':
      return <div className="mx-auto max-w-xl p-3"><JobProjectTools part="crews" jobId="job-1" canEdit isOwner={false} /></div>
    case 'selection-customer':
      return <SelectionClient token="abcdefghijklmnopqrstuvwx" view={HARNESS_PUBLIC_SELECTION as never} />
    case 'crew-daily-log':
      return <CrewPhotoCapture token="tok" tradeLabel="Framing" addressText="12 Elm Street, Concord NC 28025" jobNumber="26-0042" initialCounts={{ final_front: 1 }} brand={DEFAULT_DOCUMENT_BRAND} dailyLog />
    case 'my-pay':
      return <div className="mx-auto max-w-xl p-4"><MyPayClient /></div>
    case 'admin-settings':
      return <GeneralSettingsHarness canEditBrand />
    case 'admin-settings-readonly':
      return <GeneralSettingsHarness canEditBrand={false} />
    case 'move-from-jobber':
    case 'move-from-jobber-done':
      return <div className="mx-auto max-w-3xl p-4"><h1 className="text-ui-xl font-bold text-ink">Move from Jobber</h1><MoveFromJobber /></div>
    case 'move-signed-docs':
      return <div className="mx-auto max-w-3xl p-4"><h1 className="text-ui-xl font-bold text-ink">Move signed documents</h1><MoveSignedDocuments /></div>
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
    case 'new-lead':
      return (
        <div className="mx-auto max-w-3xl p-4">
          <LeadFormWithReferral
            orgId="o1"
            userId="p1"
            nameLabel="Customer / company name"
            serviceChoices={['Weekly lawn care', 'Pressure washing']}
            ownerChoices={[{ id: 'p1', name: 'Jordan Rivera' }, { id: 'p2', name: 'Sam Okafor-Whitfield' }]}
          />
        </div>
      )
    case 'lead-routing-settings':
      return (
        <div className="mx-auto max-w-3xl p-4">
          <LeadRoutingSettings
            initial={{
              routing: { mode: 'service', userIds: [], rules: [{ service: 'Weekly lawn care', userIds: ['p1'] }, { service: 'Pressure washing', userIds: ['p1', 'p2'] }] },
              reminder: { enabled: true, hours: 24 },
              leadOwnerId: null,
              people: [{ id: 'p1', name: 'Jordan Rivera' }, { id: 'p2', name: 'Sam Okafor-Whitfield' }],
              sources: [{ id: 's1', name: 'Website Contact Form', routing: null, autoAssignUserId: null, services: ['Weekly lawn care', 'Pressure washing'] }],
              services: ['Weekly lawn care', 'Pressure washing'],
            }}
          />
        </div>
      )
    case 'customer-messages-settings':
      return <div className="mx-auto max-w-3xl p-4"><CustomerMessagesSettings initial={HARNESS_MESSAGES_VIEW} /></div>
    case 'texting-settings':
      return <div className="mx-auto max-w-3xl p-4"><TextingSettings /></div>
    case 'text-customer':
      return <TextCustomerDialog dealId="d1" open onClose={() => undefined} onSent={() => undefined} />
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
    case 'crew-incentives-settings':
      return <div className="mx-auto max-w-md p-4"><CrewIncentivesSettingsCard /></div>
    case 'crew-scoreboard':
      return <div className="mx-auto max-w-md p-4"><CrewScoreboardCard data={HARNESS_CREW_SCOREBOARD as never} /></div>
    case 'hourly-settings':
      return <div className="mx-auto max-w-md p-4"><HourlyBillingSettingsCard /></div>
    case 'customer-invoices':
      return <div className="mx-auto max-w-2xl p-4"><CustomerInvoicesCard customerId="c1" /></div>
    case 'portal-signin':
      return <PortalSignIn company={HARNESS_PORTAL_COMPANY} />
    case 'portal-roofing':
      return <PortalHomeView company={HARNESS_PORTAL_COMPANY} home={HARNESS_PORTAL_ROOFING_HOME} payOnline />
    case 'portal-home':
      return <PortalHomeView company={HARNESS_PORTAL_COMPANY} home={HARNESS_PORTAL_HOME} payOnline />
    case 'pay-page':
      return <PayClient token="harness-pay-token-harness-pay-token-harness" view={HARNESS_PAY_VIEW} returned={false} />
    case 'pay-page-paid':
      return <PayClient token="harness-pay-token-harness-pay-token-harness" view={{ ...HARNESS_PAY_VIEW, state: 'paid' }} returned />
    case 'save-card-page':
      return <PayClient token="harness-pay-token-harness-pay-token-harness" view={{ ...HARNESS_PAY_VIEW, kind: 'save_card', state: 'save_card', invoice: null, cardOnFile: 'Visa •••• 4242' }} returned={false} />
    case 'quickbooks-settings':
      return <div className="mx-auto max-w-2xl p-4"><QuickBooksCard /></div>
    case 'quickbooks-mapping':
      return <div className="mx-auto max-w-2xl p-4"><QuickBooksMappingCard /></div>
    case 'quickbooks-backfill':
      return <div className="mx-auto max-w-2xl p-4"><QuickBooksBackfillCard /></div>
    case 'quickbooks-setup':
      return <div className="mx-auto max-w-2xl p-4"><QuickBooksSetup /></div>
    case 'quickbooks-activity':
      return <div className="mx-auto max-w-2xl p-4"><QuickBooksActivityCard /></div>
    case 'online-payments-settings':
      return <div className="mx-auto max-w-2xl p-4"><OnlinePaymentsCard /></div>
    case 'quote-page':
      return <QuoteClient token="harness-quote-token-harness-quote-token-ab" view={HARNESS_QUOTE_VIEW} />
    case 'quote-page-approved':
      return <QuoteClient token="harness-quote-token-harness-quote-token-ab" view={{ ...HARNESS_QUOTE_VIEW, state: 'approved', approval: { typedName: 'Pat Doe', approvedAt: '2026-11-11T15:00:00.000Z', totalCents: 180000, depositCents: 45000, taxCents: 11800, chosenNames: ['Mulch refresh (6 yards)'], depositState: 'due', canPayOnline: true, copyHref: '/api/files/signed/contract/harness' } }} />
    case 'quote-send-card':
      return <div className="mx-auto max-w-2xl p-4"><QuoteLinkCard proposalId="harness-proposal" /></div>
    case 'quote-settings':
      return <div className="mx-auto max-w-2xl p-4"><QuoteApprovalCard /></div>
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
    case 'crew-day-money':
      return <CrewDayList token="harness-token-harness-token-harness-5" crewName="Green Team" companyName="Precision Maintenance" today="2026-11-10" visits={HARNESS_CREW_DAY_MONEY as CrewDayVisit[]} />
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
    case 'area-measure':
      return (
        <AreaMeasureClient
          address="1 Harness Way, Crawfordville, FL"
          lat={30.176}
          lng={-84.375}
          refs={{ customerId: 'cust-1', propertyId: null, opportunityId: null, leadId: null }}
          forLabel="Pat Lee"
          canSave
          cannotSaveReason={null}
          settings={{ mulchDepthIn: 3, strawSqftPerBale: 50 }}
          canEditSettings
          backHref="/dev-harness/yard-card"
          mapsApiKey="harness-key"
        />
      )
    case 'area-measure-readonly':
      return (
        <AreaMeasureClient
          address={null}
          lat={null}
          lng={null}
          refs={{ customerId: null, propertyId: null, opportunityId: null, leadId: null }}
          forLabel={null}
          canSave={false}
          cannotSaveReason="Open this from a customer or lead to save it."
          settings={{ mulchDepthIn: 3, strawSqftPerBale: 50 }}
          canEditSettings={false}
          backHref="/dev-harness/yard-card"
          mapsApiKey="harness-key"
        />
      )
    case 'yard-card':
      return (
        <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
          <YardMeasureCard customerId="cust-1" opportunityId="opp-1" rows={HARNESS_YARD_ROWS as never} properties={[{ id: 'p1', name: 'Home' }, { id: 'p2', name: 'Rental on Oak' }]} canMeasure />
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
