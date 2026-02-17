'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  projectId: string
  existingJobId?: string | null
  existingJobNumber?: string | null
}

export default function SendToOpsButton({ projectId, existingJobId, existingJobNumber }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [saleAmount, setSaleAmount] = useState('')

  const handleSendToOps = async () => {
    setLoading(true)

    try {
      const response = await fetch('/api/ops/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          sale_amount: saleAmount ? parseFloat(saleAmount) : null,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        if (response.status === 409) {
          // Job already exists
          alert(`Production job already exists: ${data.job_number}`)
          router.push(`/ops/jobs/${data.job_id}`)
          return
        }
        throw new Error(data.error || 'Failed to create production job')
      }

      alert(`Production job ${data.job.job_number} created!`)
      setShowModal(false)
      router.push(`/ops/jobs/${data.job.id}`)
    } catch (error: any) {
      console.error('Error sending to ops:', error)
      alert(error.message || 'Failed to send to operations')
    } finally {
      setLoading(false)
    }
  }

  // If job already exists, show link to it
  if (existingJobId) {
    return (
      <a
        href={`/ops/jobs/${existingJobId}`}
        className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        View Job {existingJobNumber}
      </a>
    )
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
        Send to Operations
      </button>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6 border-b">
              <h2 className="text-xl font-bold text-gray-900">Send to Operations</h2>
              <p className="text-gray-500 text-sm mt-1">
                Create a production job for scheduling and installation
              </p>
            </div>
            <div className="p-6">
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Sale Amount (optional)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-500">$</span>
                  <input
                    type="number"
                    value={saleAmount}
                    onChange={(e) => setSaleAmount(e.target.value)}
                    className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="0.00"
                    step="0.01"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Enter the contract/sale amount for this job
                </p>
              </div>
            </div>
            <div className="p-6 border-t flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSendToOps}
                disabled={loading}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? 'Creating...' : 'Create Production Job'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
