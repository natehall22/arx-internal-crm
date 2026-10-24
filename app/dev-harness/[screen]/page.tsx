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
import { HARNESS_CONTRACT } from '@/e2e/fixtures'
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
import { visibleSettingsGroups } from '@/lib/settings-registry'
import { QueueCard, KpiTiles } from '@/components/today/QueueCard'
import FileHeader from '@/components/customer-file/FileHeader'
import FileTabs from '@/components/customer-file/FileTabs'
import ThreadPanel from '@/components/customer-file/ThreadPanel'
import { HARNESS_FILE_CTX } from '@/e2e/fixtures'
import { HARNESS_QUEUES } from '@/e2e/fixtures'

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
    case 'contract-signing':
      return <ContractSigningForm contract={HARNESS_CONTRACT as never} token="tok" />
    case 'change-order-signing':
      return <ChangeOrderSigningForm changeOrder={{ co_number: 'CO-1', description: 'Replace 3 sheets of rotten decking at the rear slope. Add 40 LF of drip edge.', customer_print_name: 'Pat Customer', updated_total: 16825 }} token="tok" />
    case 'crew-capture':
      return <CrewPhotoCapture token="tok" tradeLabel="Roofing" addressText="12 Elm Street, Concord NC 28025" jobNumber="26-0042" initialCounts={{ final_front: 1 }} />
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
    case 'pay-week':
      return <div className="mx-auto max-w-3xl p-4"><PayWeekClient /></div>
    default:
      notFound()
  }
}
