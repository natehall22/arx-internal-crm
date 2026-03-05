'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSubPortalLanguage, LanguageToggle } from '@/lib/i18n/SubPortalLanguageContext'

interface SubJob {
  id: string
  job_number: string
  job_type: string
  status: string
  address_text: string
  scheduled_date: string | null
  scheduled_time_start: string | null
  estimated_duration_hours: number | null
  customer_name: string | null
  customer_phone: string | null
  scope_of_work: string | null
  product_summary: string | null
}

interface SubJobsClientProps {
  jobs: SubJob[]
  companyName: string
}

export default function SubJobsClient({ jobs, companyName }: SubJobsClientProps) {
  const { t, getStatusLabel } = useSubPortalLanguage()
  const [filter, setFilter] = useState<string>('all')

  const filteredJobs = filter === 'all' 
    ? jobs 
    : jobs.filter(j => j.status === filter)

  const upcomingJobs = jobs.filter(j => j.status === 'scheduled')
  const inProgressJobs = jobs.filter(j => j.status === 'in_progress')
  const completedJobs = jobs.filter(j => j.status === 'complete')

  const statusColors: Record<string, { bg: string; text: string }> = {
    scheduled: { bg: 'bg-purple-100', text: 'text-purple-700' },
    in_progress: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
    complete: { bg: 'bg-green-100', text: 'text-green-700' },
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{companyName}</h1>
              <p className="text-sm text-gray-500">{t('subContractorPortal')}</p>
            </div>
            <div className="flex items-center gap-4">
              <LanguageToggle />
              <Link
                href="/api/auth/signout"
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                {t('signOut')}
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4">
          <nav className="flex gap-6">
            <Link
              href="/subs/jobs"
              className="py-3 text-sm font-medium text-indigo-600 border-b-2 border-indigo-600"
            >
              {t('jobs')}
            </Link>
            <Link
              href="/subs/work-orders"
              className="py-3 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent"
            >
              {t('workOrders')}
            </Link>
          </nav>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm border p-4 text-center">
            <p className="text-2xl font-bold text-purple-600">{upcomingJobs.length}</p>
            <p className="text-sm text-gray-500">{t('upcoming')}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm border p-4 text-center">
            <p className="text-2xl font-bold text-indigo-600">{inProgressJobs.length}</p>
            <p className="text-sm text-gray-500">{t('inProgress')}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm border p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{completedJobs.length}</p>
            <p className="text-sm text-gray-500">{t('completed')}</p>
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-2 mb-4">
          {['all', 'scheduled', 'in_progress', 'complete'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-sm font-medium rounded-full ${
                filter === f
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-700 border hover:bg-gray-50'
              }`}
            >
              {f === 'all' ? t('all') : getStatusLabel(f)}
            </button>
          ))}
        </div>

        {/* Jobs List */}
        <div className="space-y-3">
          {filteredJobs.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm border p-8 text-center">
              <p className="text-gray-500">{t('noJobs')}</p>
            </div>
          ) : (
            filteredJobs.map(job => {
              const statusStyle = statusColors[job.status] || statusColors.scheduled
              return (
                <Link
                  key={job.id}
                  href={`/subs/jobs/${job.id}`}
                  className="block bg-white rounded-lg shadow-sm border p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-gray-600">{job.job_number}</span>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
                          {getStatusLabel(job.status)}
                        </span>
                      </div>
                      <p className="font-medium text-gray-900 mt-1">{job.customer_name || t('customer')}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      job.job_type === 'roofing' ? 'bg-blue-100 text-blue-700' :
                      job.job_type === 'siding' ? 'bg-green-100 text-green-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {job.job_type}
                    </span>
                  </div>

                  <p className="text-sm text-gray-600 mb-2">{job.address_text}</p>

                  {job.scheduled_date && (
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-gray-900">
                        {new Date(job.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric'
                        })}
                      </span>
                      {job.scheduled_time_start && (
                        <span className="text-gray-500">{job.scheduled_time_start}</span>
                      )}
                      {job.estimated_duration_hours && (
                        <span className="text-gray-500">{job.estimated_duration_hours}h</span>
                      )}
                    </div>
                  )}

                  {job.product_summary && (
                    <p className="text-xs text-gray-500 mt-2 truncate">{job.product_summary}</p>
                  )}
                </Link>
              )
            })
          )}
        </div>
      </main>
    </div>
  )
}
