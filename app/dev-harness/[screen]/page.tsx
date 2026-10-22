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
import { HARNESS_OPS_JOBS } from '@/e2e/fixtures'
import JobDetailClient from '@/app/ops/jobs/[id]/JobDetailClient'
import { HARNESS_JOB } from '@/e2e/fixtures'
import ContractModal from '@/components/contracts/ContractModal'
import ExploreClient from '@/app/reports/explore/ExploreClient'
import ReportsPage from '@/app/reports/page'
import PayrollPeriodsPage from '@/app/admin/payroll/periods/page'
import { HARNESS_NEEDS_YOU, HARNESS_RUN_SHEET, HARNESS_DASHBOARD } from '@/e2e/fixtures'
import JobSheetsEditor from '@/app/ops/jobs/[id]/sheets/JobSheetsEditor'
import DashboardClient from '@/app/dashboard/DashboardClient'

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
      return <div className="p-3"><NeedsYouList report={HARNESS_NEEDS_YOU} /></div>
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
    case 'ops-board':
      return <OpsClient initialJobs={HARNESS_OPS_JOBS as never} orgId="org-1" canViewProfitability />
    case 'job-page':
      return (
        <JobDetailClient
          initialJob={HARNESS_JOB as never}
          paymentMethod="finance"
          userRole="admin"
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
    case 'reports-home':
      return <ReportsPage />
    case 'reports-explore':
      return <ExploreClient />
    case 'job-sheets':
      return <JobSheetsEditor initialSheet={HARNESS_RUN_SHEET as never} canEdit scope={null} coverage={{} as never} showOrder={false} />
    case 'dashboard':
      return <DashboardClient {...(HARNESS_DASHBOARD as never)} pendingPrompts={[]} upcomingAppointments={[]} recentActivities={[]} settings={{}} />
    case 'payroll-periods':
      return <PayrollPeriodsPage />
    default:
      notFound()
  }
}
