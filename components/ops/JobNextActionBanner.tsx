'use client'

import { useEffect, useState } from 'react'
import { JobPaymentSummary } from '@/lib/types/job-payments'
import { checkDepositStatus, type DepositCheckResult } from '@/lib/job-deposit'

type JobStatus = 'sold' | 'materials' | 'scheduled' | 'in_progress' | 'complete' | 'collected' | 'on_hold'

interface JobNextActionBannerProps {
  jobId: string
  status: JobStatus
  saleAmount: number | null
  depositRequiredPercent: number | null
  paymentMethod?: string | null
  materialsStatus: string
  scheduledDate: string | null
  assignedCrewId: string | null
  assignedSubId: string | null
  financeSubmittedAt?: string | null
  refreshKey?: number
  onOrderMaterials?: () => void
  onSchedule?: () => void
  onMarkJobComplete?: () => void
  onStartJob?: () => void
}

interface NextAction {
  message: string
  buttonText: string
  color: 'blue' | 'amber' | 'purple' | 'green' | 'gray'
  action:
    | 'deposit'
    | 'materials'
    | 'schedule'
    | 'assign'
    | 'collect'
    | 'finance_submit'
    | 'mark_complete'
    | 'start_job'
    | 'done'
}

function getNextAction(
  status: JobStatus,
  materialsStatus: string,
  scheduledDate: string | null,
  hasCrewOrSub: boolean,
  depositSatisfied: boolean,
  depositStatus: DepositCheckResult,
  saleAmountCents: number,
  remainingBalance: number,
  isFinanceJob: boolean,
  financePaymentSubmitted: boolean
): NextAction {
  // Job on hold - special case
  if (status === 'on_hold') {
    return {
      message: 'Job is on hold',
      buttonText: 'Review',
      color: 'gray',
      action: 'done',
    }
  }

  // Collected = fully done
  if (status === 'collected') {
    return {
      message: 'Job complete and collected',
      buttonText: 'Done',
      color: 'green',
      action: 'done',
    }
  }

  // Complete but balance remaining
  if (status === 'complete' && remainingBalance > 0) {
    if (isFinanceJob && !financePaymentSubmitted) {
      return {
        message: 'Submit for finance payment',
        buttonText: 'Submit for Payment',
        color: 'amber',
        action: 'finance_submit',
      }
    }
    return {
      message: `Collect final payment: $${(remainingBalance / 100).toLocaleString()}`,
      buttonText: 'Record Payment',
      color: 'amber',
      action: 'collect',
    }
  }

  // Complete and paid
  if (status === 'complete') {
    if (isFinanceJob && !financePaymentSubmitted) {
      return {
        message: 'Submit for finance payment',
        buttonText: 'Submit for Payment',
        color: 'amber',
        action: 'finance_submit',
      }
    }
    return {
      message: isFinanceJob ? 'Finance payment submitted' : 'Ready to mark as collected',
      buttonText: isFinanceJob ? 'Done' : 'Mark as Collected',
      color: 'green',
      action: 'done',
    }
  }

  // Deposit not satisfied yet
  if (!depositSatisfied) {
    return {
      message: 'Collect deposit to get started',
      buttonText: 'Record Deposit',
      color: 'blue',
      action: 'deposit',
    }
  }

  // Materials not ordered
  if (materialsStatus === 'not_ordered') {
    return {
      message: 'Order materials for this job',
      buttonText: 'Open Job Costs',
      color: 'amber',
      action: 'materials',
    }
  }

  // Materials ordered but not scheduled
  if (!scheduledDate && materialsStatus !== 'not_ordered') {
    return {
      message: 'Schedule the install date',
      buttonText: 'Schedule',
      color: 'purple',
      action: 'schedule',
    }
  }

  // Scheduled but no crew/sub assigned
  if (scheduledDate && !hasCrewOrSub) {
    return {
      message: 'Assign a crew or sub',
      buttonText: 'Assign',
      color: 'purple',
      action: 'assign',
    }
  }

  // In progress
  if (status === 'in_progress') {
    return {
      message: 'Job in progress',
      buttonText: 'Mark Job Complete',
      color: 'blue',
      action: 'mark_complete',
    }
  }

  // Scheduled and assigned - ready to go
  if (status === 'scheduled' && hasCrewOrSub) {
    return {
      message: 'Ready for install',
      buttonText: 'Start Job',
      color: 'green',
      action: 'start_job',
    }
  }

  // Default
  return {
    message: 'Review job details',
    buttonText: 'Review',
    color: 'gray',
    action: 'done',
  }
}

const colorStyles = {
  blue: 'bg-blue-50 border-blue-200 text-blue-800',
  amber: 'bg-amber-50 border-amber-200 text-amber-800',
  purple: 'bg-purple-50 border-purple-200 text-purple-800',
  green: 'bg-green-50 border-green-200 text-green-800',
  gray: 'bg-gray-50 border-gray-200 text-gray-600',
}

const buttonStyles = {
  blue: 'bg-blue-600 hover:bg-blue-700 text-white',
  amber: 'bg-amber-600 hover:bg-amber-700 text-white',
  purple: 'bg-purple-600 hover:bg-purple-700 text-white',
  green: 'bg-green-600 hover:bg-green-700 text-white',
  gray: 'bg-gray-600 hover:bg-gray-700 text-white',
}

export default function JobNextActionBanner({
  jobId,
  status,
  saleAmount,
  depositRequiredPercent,
  paymentMethod = null,
  materialsStatus,
  scheduledDate,
  assignedCrewId,
  assignedSubId,
  financeSubmittedAt = null,
  refreshKey = 0,
  onOrderMaterials,
  onSchedule,
  onMarkJobComplete,
  onStartJob,
}: JobNextActionBannerProps) {
  const [paymentSummary, setPaymentSummary] = useState<JobPaymentSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [financePaymentSubmitted, setFinancePaymentSubmitted] = useState(!!financeSubmittedAt)

  useEffect(() => {
    const loadPayments = async () => {
      setLoading(true)
      try {
        const response = await fetch(`/api/ops/jobs/${jobId}/payments?_t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        })
        if (response.ok) {
          const data = await response.json()
          if (typeof window !== 'undefined' && (window as any).__DEBUG_NEXT_ACTION__) {
            console.log('[NextAction] Loaded payments:', {
              jobId,
              refreshKey,
              collected_cents: data.collected_cents,
              payment_count: data.payment_count,
              payments: data.payments?.map((p: any) => ({ type: p.payment_type, amount: p.amount_cents })),
            })
          }
          setPaymentSummary(data)
        }
      } catch (error) {
        console.error('Error loading payments:', error)
      } finally {
        setLoading(false)
      }
    }
    loadPayments()
  }, [jobId, refreshKey])

  // Use sale_amount_cents from API for consistency, fallback to prop calculation
  const saleAmountCents = paymentSummary?.sale_amount_cents ?? Math.round((saleAmount || 0) * 100)
  const collectedCents = paymentSummary?.collected_cents || 0
  const remainingCents = paymentSummary?.remaining_cents ?? (saleAmountCents - collectedCents)
  const payments = paymentSummary?.payments || []
  const depositPercent = depositRequiredPercent ?? 0.5
  const hasCrewOrSub = !!(assignedCrewId || assignedSubId)

  const depositStatus = checkDepositStatus(
    payments,
    collectedCents,
    saleAmountCents,
    depositPercent
  )
  const isFinanceJob = (paymentMethod || '').toLowerCase() === 'finance'
  const depositSatisfied = isFinanceJob ? true : depositStatus.satisfied

  useEffect(() => {
    if (!isFinanceJob || status !== 'complete') {
      setFinancePaymentSubmitted(false)
      return
    }
    // Restore persisted state from DB column whenever job/refreshKey changes
    setFinancePaymentSubmitted(!!financeSubmittedAt)
  }, [isFinanceJob, status, jobId, financeSubmittedAt])

  if (loading) {
    return null
  }
  
  // Debug logging (can be removed in production)
  if (typeof window !== 'undefined' && (window as any).__DEBUG_NEXT_ACTION__) {
    console.log('[NextAction] Deposit status:', depositStatus)
    console.log('[NextAction] Final state:', {
      depositSatisfied,
      status,
      materialsStatus,
      scheduledDate,
      hasCrewOrSub,
      remainingCents,
    })
  }

  const nextAction = getNextAction(
    status,
    materialsStatus,
    scheduledDate,
    hasCrewOrSub,
    depositSatisfied,
    depositStatus,
    saleAmountCents,
    remainingCents,
    isFinanceJob,
    financePaymentSubmitted
  )

  const handleClick = () => {
    switch (nextAction.action) {
      case 'deposit':
      case 'collect': {
        const el = document.getElementById('payments-section')
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        break
      }
      case 'materials':
        // Scroll to materials section
        document.getElementById('materials-section')?.scrollIntoView({ behavior: 'smooth' })
        break
      case 'schedule':
      case 'assign':
        onSchedule?.()
        break
      case 'finance_submit':
        setFinancePaymentSubmitted(true)
        fetch(`/api/ops/jobs/${jobId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ finance_submitted_at: new Date().toISOString() }),
        }).catch((err) => console.error('Failed to persist finance_submitted_at:', err))
        break
      case 'mark_complete':
        onMarkJobComplete?.()
        break
      case 'start_job':
        onStartJob?.()
        break
      default:
        // No action needed
        break
    }
  }

  return (
    <div className={`rounded-lg border p-4 mb-6 flex items-center justify-between ${colorStyles[nextAction.color]}`}>
      <div className="flex items-center gap-3">
        <div className="text-lg">
          {nextAction.color === 'green' ? '✓' : 
           nextAction.color === 'amber' ? '⚠' : 
           nextAction.color === 'purple' ? '📅' : 
           nextAction.color === 'blue' ? '→' : '•'}
        </div>
        <div>
          <div className="font-semibold">Next Action</div>
          <div className="text-sm opacity-90">{nextAction.message}</div>
        </div>
      </div>
      {nextAction.action !== 'done' && (
        <button
          onClick={handleClick}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${buttonStyles[nextAction.color]}`}
        >
          {nextAction.buttonText}
        </button>
      )}
    </div>
  )
}
