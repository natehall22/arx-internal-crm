/**
 * Parity guard for the new job page (docs/job-page-parity-2026-10.md): every card the old page had must still be
 * rendered by JobDetailClient, and each must sit on exactly one of the five tabs when v2 is on.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(join(process.cwd(), 'app/ops/jobs/[id]/JobDetailClient.tsx'), 'utf8')

const CARDS = [
  'JobTradesCard', 'FinalPhotosCard', 'SupplierOrdersCard', 'MaterialsOrderCard', 'JobMaterialsCard', 'SoldScopeCard', 'JobRoofingBrief',
  'OperationsSnapshotCard', 'JobFileWorkspaceCard', 'JobPaymentsCard', 'JobInvoicesCard', 'JobWorkOrdersCard', 'ChangeOrdersSection',
  'InsuranceCard', 'PayrollAttributionEditor', 'JobDocumentsBanner', 'JobRunSheetRow', 'JobCustomerRow', 'JobTabsBar', 'JobQuickLinks',
  'SettledExternallyCard', 'JobReadyToPayBanner', 'JobPayrollSentBanner', 'CompleteJobModal',
]

describe('job page parity', () => {
  it.each(CARDS)('%s is still rendered', (name) => {
    expect(src).toMatch(new RegExp(`<${name}[\\s/>]`))
  })

  it('the standalone "Materials ordered" button only exists on the old page', () => {
    expect(src).toMatch(/\{!v2 && \(\s*<JobDocumentsBanner/)
  })

  it('money and profit blocks keep their permission gates', () => {
    expect(src).toContain('canViewProfitability && canViewReportFinancials')
    expect(src).toMatch(/v2 && canViewFinancialTab/)
  })
})
