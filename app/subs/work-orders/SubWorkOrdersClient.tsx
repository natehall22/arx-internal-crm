'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSubPortalLanguage, LanguageToggle } from '@/lib/i18n/SubPortalLanguageContext'
import WorkOrderCompletionModal from './WorkOrderCompletionModal'

interface WorkOrder {
  id: string
  work_order_number: string
  work_order_type: string
  status: string
  priority: string
  title: string
  description: string | null
  full_address: string
  scheduled_date: string | null
  scheduled_time_start: string | null
  estimated_hours: number | null
  materials: any[] | null
  completion_notes: string | null
  sub_completion_notes: string | null
  completed_at: string | null
  job_id: string | null
  customer_name: string | null
  customer_phone: string | null
  photo_counts: { work_done: number; cleanup: number }
}

interface SubWorkOrdersClientProps {
  workOrders: WorkOrder[]
  companyName: string
}

export default function SubWorkOrdersClient({ workOrders, companyName }: SubWorkOrdersClientProps) {
  const { t, getStatusLabel, getWorkOrderTypeLabel, getPriorityLabel } = useSubPortalLanguage()
  const [filter, setFilter] = useState<string>('all')
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null)
  const [showCompletionModal, setShowCompletionModal] = useState(false)

  const filteredWorkOrders = filter === 'all' 
    ? workOrders 
    : workOrders.filter(wo => wo.status === filter)

  const pendingCount = workOrders.filter(wo => ['pending', 'assigned', 'scheduled'].includes(wo.status)).length
  const inProgressCount = workOrders.filter(wo => wo.status === 'in_progress').length
  const completedCount = workOrders.filter(wo => wo.status === 'completed').length

  const statusColors: Record<string, { bg: string; text: string }> = {
    pending: { bg: 'bg-gray-100', text: 'text-gray-700' },
    assigned: { bg: 'bg-blue-100', text: 'text-blue-700' },
    scheduled: { bg: 'bg-purple-100', text: 'text-purple-700' },
    in_progress: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
    completed: { bg: 'bg-green-100', text: 'text-green-700' },
    cancelled: { bg: 'bg-red-100', text: 'text-red-700' },
    on_hold: { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  }

  const priorityColors: Record<string, string> = {
    low: 'text-gray-500',
    normal: 'text-blue-600',
    high: 'text-orange-600',
    urgent: 'text-red-600',
  }

  const handleCompleteClick = (wo: WorkOrder) => {
    setSelectedWorkOrder(wo)
    setShowCompletionModal(true)
  }

  const handleCompletionSuccess = () => {
    setShowCompletionModal(false)
    setSelectedWorkOrder(null)
    window.location.reload()
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
              className="py-3 text-sm font-medium text-gray-500 hover:text-gray-700 border-b-2 border-transparent"
            >
              {t('jobs')}
            </Link>
            <Link
              href="/subs/work-orders"
              className="py-3 text-sm font-medium text-indigo-600 border-b-2 border-indigo-600"
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
            <p className="text-2xl font-bold text-purple-600">{pendingCount}</p>
            <p className="text-sm text-gray-500">{t('statusPending')}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm border p-4 text-center">
            <p className="text-2xl font-bold text-indigo-600">{inProgressCount}</p>
            <p className="text-sm text-gray-500">{t('inProgress')}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm border p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{completedCount}</p>
            <p className="text-sm text-gray-500">{t('completed')}</p>
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {['all', 'pending', 'assigned', 'scheduled', 'in_progress', 'completed'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-sm font-medium rounded-full whitespace-nowrap ${
                filter === f
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-700 border hover:bg-gray-50'
              }`}
            >
              {f === 'all' ? t('all') : getStatusLabel(f)}
            </button>
          ))}
        </div>

        {/* Work Orders List */}
        <div className="space-y-3">
          {filteredWorkOrders.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm border p-8 text-center">
              <p className="text-gray-500">{t('noWorkOrders')}</p>
            </div>
          ) : (
            filteredWorkOrders.map(wo => {
              const statusStyle = statusColors[wo.status] || statusColors.pending
              const canComplete = ['pending', 'assigned', 'scheduled', 'in_progress'].includes(wo.status)
              const totalPhotos = wo.photo_counts.work_done + wo.photo_counts.cleanup

              return (
                <div
                  key={wo.id}
                  className="bg-white rounded-lg shadow-sm border p-4"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm text-gray-600">{wo.work_order_number}</span>
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
                          {getStatusLabel(wo.status)}
                        </span>
                        {wo.priority !== 'normal' && (
                          <span className={`text-xs font-medium ${priorityColors[wo.priority]}`}>
                            {getPriorityLabel(wo.priority)}
                          </span>
                        )}
                      </div>
                      <p className="font-medium text-gray-900 mt-1">{wo.title}</p>
                      {wo.customer_name && (
                        <p className="text-sm text-gray-600">{wo.customer_name}</p>
                      )}
                    </div>
                    <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                      {getWorkOrderTypeLabel(wo.work_order_type)}
                    </span>
                  </div>

                  {wo.full_address && (
                    <p className="text-sm text-gray-600 mb-2">{wo.full_address}</p>
                  )}

                  {wo.description && (
                    <p className="text-sm text-gray-500 mb-2 line-clamp-2">{wo.description}</p>
                  )}

                  <div className="flex items-center gap-4 text-sm mb-3">
                    {wo.scheduled_date && (
                      <span className="text-gray-900">
                        {new Date(wo.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric'
                        })}
                      </span>
                    )}
                    {wo.scheduled_time_start && (
                      <span className="text-gray-500">{wo.scheduled_time_start}</span>
                    )}
                    {wo.estimated_hours && (
                      <span className="text-gray-500">{wo.estimated_hours}h</span>
                    )}
                    {totalPhotos > 0 && (
                      <span className="text-gray-500 flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {totalPhotos} {t('photos')}
                      </span>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-2">
                    {wo.full_address && (
                      <a
                        href={`https://maps.google.com/?q=${encodeURIComponent(wo.full_address)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 text-center px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 min-h-[44px] flex items-center justify-center"
                      >
                        {t('openInMaps')} →
                      </a>
                    )}
                    {canComplete && (
                      <button
                        onClick={() => handleCompleteClick(wo)}
                        className="flex-1 px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 min-h-[44px]"
                      >
                        {t('markComplete')}
                      </button>
                    )}
                  </div>

                  {/* Completion info if completed */}
                  {wo.status === 'completed' && wo.sub_completion_notes && (
                    <div className="mt-3 pt-3 border-t">
                      <p className="text-xs text-gray-500 mb-1">{t('completionNote')}:</p>
                      <p className="text-sm text-gray-700">{wo.sub_completion_notes}</p>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </main>

      {/* Completion Modal */}
      {showCompletionModal && selectedWorkOrder && (
        <WorkOrderCompletionModal
          workOrder={selectedWorkOrder}
          onClose={() => {
            setShowCompletionModal(false)
            setSelectedWorkOrder(null)
          }}
          onSuccess={handleCompletionSuccess}
        />
      )}
    </div>
  )
}
