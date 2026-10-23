'use client'

import JobInvoicesCard from '@/components/ops/JobInvoicesCard'
import JobPaymentsCard from '@/components/ops/JobPaymentsCard'

/** Money tab: the existing payments + invoices cards, one place. Billing roles only (the server decides `canBill`). */
export default function MoneyCards({ jobId, saleAmount, jobSource, customerEmail, canBill }: { jobId: string; saleAmount: number | null; jobSource: 'retail' | 'insurance' | null; customerEmail: string | null; canBill: boolean }) {
  return (
    <div className="space-y-4">
      {canBill ? (
        <>
          <JobPaymentsCard jobId={jobId} saleAmount={saleAmount} />
          <JobInvoicesCard jobId={jobId} saleAmount={saleAmount} jobSource={jobSource} customerEmail={customerEmail} />
        </>
      ) : (
        <div className="rounded-ui border border-amber-200 bg-surface p-4 text-ui-base text-ink">
          Recording deposits and payments is limited to admin, owner, operations and finance roles.
        </div>
      )}
    </div>
  )
}
