'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'

export default function NewEstimatePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const projectId = searchParams.get('project_id')
  
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) {
      setError('No project specified')
      setLoading(false)
      return
    }

    async function createEstimate() {
      try {
        const response = await fetch('/api/estimates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: projectId }),
        })

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.error || 'Failed to create estimate')
        }

        const estimate = await response.json()
        router.replace(`/estimates/${estimate.id}`)
      } catch (err) {
        console.error('Error creating estimate:', err)
        setError(err instanceof Error ? err.message : 'Failed to create estimate')
        setLoading(false)
      }
    }

    createEstimate()
  }, [projectId, router])

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <h2 className="text-lg font-semibold text-red-800 mb-2">Error</h2>
            <p className="text-red-600 mb-4">{error}</p>
            {projectId ? (
              <Link
                href={`/projects/${projectId}`}
                className="text-indigo-600 hover:text-indigo-800 font-medium"
              >
                ← Back to Project
              </Link>
            ) : (
              <Link
                href="/projects"
                className="text-indigo-600 hover:text-indigo-800 font-medium"
              >
                ← Back to Projects
              </Link>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Creating estimate...</p>
          </div>
        </div>
      </div>
    </div>
  )
}
