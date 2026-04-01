'use client'

import { useState, useEffect } from 'react'
import { formatCurrency } from '@/lib/job-payments'
import { JobPaymentSummary } from '@/lib/types/job-payments'
import Link from 'next/link'

interface ProjectFinancialSnapshotProps {
  projectId: string
  jobId: string | null
  jobNumber: string | null
  contractTotal: number | null
  /** When false, hide the link to `/ops/jobs/:id` (e.g. user cannot access job board). */
  showJobDetailLink?: boolean
}

export default function ProjectFinancialSnapshot({ 
  projectId, 
  jobId, 
  jobNumber,
  contractTotal,
  showJobDetailLink = false,
}: ProjectFinancialSnapshotProps) {
  const [summary, setSummary] = useState<JobPaymentSummary | null>(null)
  const [loading, setLoading] = useState(!!jobId)

  useEffect(() => {
    if (!jobId) return

    const loadPayments = async () => {
      try {
        const response = await fetch(`/api/ops/jobs/${jobId}/payments`)
        if (response.ok) {
          const data = await response.json()
          setSummary(data)
        }
      } catch (error) {
        console.error('Error loading payments:', error)
      } finally {
        setLoading(false)
      }
    }

    loadPayments()
  }, [jobId])

  const contractCents = Math.round((contractTotal || 0) * 100)
  const collectedCents = summary?.collected_cents || 0
  const remainingCents = contractCents - collectedCents
  const percentCollected = contractCents > 0 
    ? Math.round((collectedCents / contractCents) * 100) 
    : 0

  return (
    <div className="bg-white shadow rounded-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Financial Snapshot</h2>
        {jobId && jobNumber && showJobDetailLink && (
          <Link 
            href={`/ops/jobs/${jobId}`}
            className="text-xs text-indigo-600 hover:text-indigo-800"
          >
            View Job {jobNumber} →
          </Link>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-xs text-gray-500 mb-1">Contract Total</div>
          <div className="text-xl font-semibold text-gray-900">
            {contractCents > 0 ? formatCurrency(contractCents) : '-'}
          </div>
        </div>

        {jobId ? (
          <>
            <div>
              <div className="text-xs text-gray-500 mb-1">Collected</div>
              <div className="text-xl font-semibold text-green-600">
                {loading ? (
                  <span className="text-gray-400">...</span>
                ) : (
                  formatCurrency(collectedCents)
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Remaining</div>
              <div className={`text-xl font-semibold ${remainingCents > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                {loading ? (
                  <span className="text-gray-400">...</span>
                ) : (
                  formatCurrency(remainingCents)
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="col-span-2 flex items-center">
            <span className="text-sm text-gray-400">
              Send to Ops to track payments
            </span>
          </div>
        )}
      </div>

      {jobId && !loading && contractCents > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>Collection Progress</span>
            <span>{percentCollected}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-green-500 transition-all duration-300"
              style={{ width: `${Math.min(percentCollected, 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
