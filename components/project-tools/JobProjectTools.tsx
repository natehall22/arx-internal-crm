'use client'

import BudgetCard from './BudgetCard'
import DailyLogCard from './DailyLogCard'
import ScheduleCard from './ScheduleCard'
import SelectionsCard from './SelectionsCard'

/**
 * The project tools on a job page (feature `projectTools`). Two groups so each sits on the tab where it belongs:
 * `crews` = Schedule + Daily log; `money` = Budget vs actual + Selections. Each card loads its own data and hides when the
 * caller may not see it (budget needs job financials).
 */
export default function JobProjectTools({ part, jobId, canEdit, isOwner, onLedgerMutated }: { part: 'crews' | 'money'; jobId: string; canEdit: boolean; isOwner: boolean; onLedgerMutated?: () => void }) {
  if (part === 'crews') {
    return (
      <div className="flex flex-col gap-4">
        <ScheduleCard jobId={jobId} />
        <DailyLogCard jobId={jobId} canEdit={canEdit} />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <BudgetCard jobId={jobId} onLedgerMutated={onLedgerMutated} canEditCodes={isOwner} />
      <SelectionsCard jobId={jobId} />
    </div>
  )
}
