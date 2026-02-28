'use client'

import { useEffect, useState } from 'react'
import { JobPaymentSummary, JobPayment } from '@/lib/types/job-payments'

type JobStatus = 'sold' | 'materials' | 'scheduled' | 'in_progress' | 'complete' | 'collected' | 'on_hold'

interface JobNextActionBannerProps {
  jobId: string
  status: JobStatus
  saleAmount: number | null
  depositRequiredPercent: number | null
  materialsStatus: string
  scheduledDate: string | null
  assignedCrewId: string | null
  assignedSubId: string | null
  refreshKey?: number
  onOrderMaterials?: () => void
  onSchedule?: () => void
}

interface NextAction {
  message: string
  buttonText: string
  color: 'blue' | 'amber' | 'purple' | 'green' | 'gray'
  action: 'deposit' | 'materials' | 'schedule' | 'assign' | 'collect' | 'done'
}

function isDepositSatisfied(
  payments: JobPayment[],
  collectedCents: number,
  saleAmountCents: number,
  depositRequiredPercent: number
): boolean {
  const hasDepositPayment = payments.some(
    p => p.payment_type === 'deposit' && p.amount_cents > 0
  )
  if (hasDepositPayment) return true
  
  const requiredDepositCents = Math.round(saleAmountCents * depositRequiredPercent)
  return collectedCents >= requiredDepositCents
}

function getNextAction(
  status: JobStatus,
  materialsStatus: string,
  scheduledDate: string | null,
  hasCrewOrSub: boolean,
  depositSatisfied: boolean,
  remainingBalance: number
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
    return {
      message: `Collect final payment: $${(remainingBalance / 100).toLocaleString()}`,
      buttonText: 'Record Payment',
      color: 'amber',
      action: 'collect',
    }
  }

  // Complete and paid
  if (status === 'complete') {
    return {
      message: 'Ready to mark as collected',
      buttonText: 'Mark Collected',
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
      buttonText: 'Update Materials',
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
      buttonText: 'Mark Complete',
      color: 'blue',
      action: 'done',
    }
  }

  // Scheduled and assigned - ready to go
  if (status === 'scheduled' && hasCrewOrSub) {
    return {
      message: 'Ready for install',
      buttonText: 'Start Job',
      color: 'green',
      action: 'done',
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
  materialsStatus,
  scheduledDate,
  assignedCrewId,
  assignedSubId,
  refreshKey = 0,
  onOrderMaterials,
  onSchedule,
}: JobNextActionBannerProps) {
  const [paymentSummary, setPaymentSummary] = useState<JobPaymentSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadPayments = async () => {
      setLoading(true)
      try {
        const response = await fetch(`/api/ops/jobs/${jobId}/payments`, {
          cache: 'no-store',
        })
        if (response.ok) {
          const data = await response.json()
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

  if (loading) {
    return null
  }

  const saleAmountCents = Math.round((saleAmount || 0) * 100)
  const collectedCents = paymentSummary?.collected_cents || 0
  const remainingCents = saleAmountCents - collectedCents
  const payments = paymentSummary?.payments || []
  const depositPercent = depositRequiredPercent ?? 0.5
  const hasCrewOrSub = !!(assignedCrewId || assignedSubId)

  const depositSatisfied = isDepositSatisfied(
    payments,
    collectedCents,
    saleAmountCents,
    depositPercent
  )

  const nextAction = getNextAction(
    status,
    materialsStatus,
    scheduledDate,
    hasCrewOrSub,
    depositSatisfied,
    remainingCents
  )

  const handleClick = () => {
    switch (nextAction.action) {
      case 'deposit':
      case 'collect':
        // Scroll to payments section
        document.getElementById('payments-section')?.scrollIntoView({ behavior: 'smooth' })
        break
      case 'materials':
        // Scroll to materials section
        document.getElementById('materials-section')?.scrollIntoView({ behavior: 'smooth' })
        break
      case 'schedule':
      case 'assign':
        onSchedule?.()
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
