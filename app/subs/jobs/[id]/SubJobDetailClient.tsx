'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSubPortalLanguage, LanguageToggle } from '@/lib/i18n/SubPortalLanguageContext'

interface LineItem {
  id: string
  name: string
  description: string | null
  category: string
  quantity: number
  unit: string
}

interface JobNote {
  id: string
  note: string
  created_at: string
}

interface JobFile {
  id: string
  file_name: string
  storage_path: string
  photo_tag: string | null
  mime_type: string
  created_at: string
}

interface SubJobDetail {
  id: string
  job_number: string
  job_type: string
  status: string
  address_text: string
  scheduled_date: string | null
  scheduled_time_start: string | null
  scheduled_time_end: string | null
  estimated_duration_hours: number | null
  permit_required: boolean
  permit_number: string | null
  permit_status: string
  special_instructions: string | null
  job_packet_pdf_path: string | null
  customer_name: string | null
  customer_phone: string | null
  scope_of_work: string | null
  product_summary: string | null
  line_items: LineItem[]
  notes: JobNote[]
  files: JobFile[]
}

interface SubJobDetailClientProps {
  job: SubJobDetail
  companyName: string
}

export default function SubJobDetailClient({ job, companyName }: SubJobDetailClientProps) {
  const { t, getStatusLabel } = useSubPortalLanguage()
  const router = useRouter()
  const [updating, setUpdating] = useState(false)
  const [completionNotes, setCompletionNotes] = useState('')
  const [showCompleteModal, setShowCompleteModal] = useState(false)

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  
  const statusColors: Record<string, { bg: string; text: string }> = {
    scheduled: { bg: 'bg-purple-100', text: 'text-purple-700' },
    in_progress: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
    complete: { bg: 'bg-green-100', text: 'text-green-700' },
  }
  const statusStyle = statusColors[job.status] || statusColors.scheduled

  const handleStartJob = async () => {
    setUpdating(true)
    try {
      const response = await fetch(`/api/subs/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to start job')
      }

      router.refresh()
    } catch (err: any) {
      alert(err.message)
    } finally {
      setUpdating(false)
    }
  }

  const handleCompleteJob = async () => {
    setUpdating(true)
    try {
      const response = await fetch(`/api/subs/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          status: 'complete',
          completion_notes: completionNotes || null
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to complete job')
      }

      setShowCompleteModal(false)
      router.refresh()
    } catch (err: any) {
      alert(err.message)
    } finally {
      setUpdating(false)
    }
  }

  // Group line items by category
  const groupedItems = job.line_items.reduce((acc, item) => {
    const cat = item.category || 'Other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {} as Record<string, LineItem[]>)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/subs/jobs" className="text-gray-500 hover:text-gray-700 min-h-[44px] min-w-[44px] flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-lg font-bold text-gray-900">{job.job_number}</h1>
                <p className="text-sm text-gray-500">{companyName}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <LanguageToggle />
              <span className={`px-3 py-1 text-sm font-medium rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
                {getStatusLabel(job.status)}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {/* Action Buttons */}
        {job.status === 'scheduled' && (
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <p className="text-sm text-purple-700 mb-3">{t('readyToStart')}</p>
            <button
              onClick={handleStartJob}
              disabled={updating}
              className="w-full bg-purple-600 text-white py-2 rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 min-h-[44px]"
            >
              {updating ? t('starting') : t('startJob')}
            </button>
          </div>
        )}

        {job.status === 'in_progress' && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
            <p className="text-sm text-indigo-700 mb-3">{t('jobInProgress')}</p>
            <button
              onClick={() => setShowCompleteModal(true)}
              disabled={updating}
              className="w-full bg-green-600 text-white py-2 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 min-h-[44px]"
            >
              {t('markComplete')}
            </button>
          </div>
        )}

        {/* Customer & Schedule */}
        <div className="bg-white rounded-lg shadow-sm border p-4">
          <h2 className="font-semibold text-gray-900 mb-3">{t('jobDetails')}</h2>
          
          <div className="space-y-3">
            <div>
              <p className="text-sm text-gray-500">{t('customer')}</p>
              <p className="font-medium text-gray-900">{job.customer_name || 'N/A'}</p>
              {job.customer_phone && (
                <a href={`tel:${job.customer_phone}`} className="text-sm text-indigo-600 min-h-[44px] inline-flex items-center">
                  {job.customer_phone}
                </a>
              )}
            </div>

            <div>
              <p className="text-sm text-gray-500">{t('address')}</p>
              <p className="text-gray-900">{job.address_text}</p>
              <a 
                href={`https://maps.google.com/?q=${encodeURIComponent(job.address_text)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-indigo-600 min-h-[44px] inline-flex items-center"
              >
                {t('openInMaps')} →
              </a>
            </div>

            {job.scheduled_date && (
              <div>
                <p className="text-sm text-gray-500">{t('scheduled')}</p>
                <p className="text-gray-900">
                  {new Date(job.scheduled_date + 'T12:00:00').toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                  {job.scheduled_time_start && ` at ${job.scheduled_time_start}`}
                </p>
                {job.estimated_duration_hours && (
                  <p className="text-sm text-gray-500">{job.estimated_duration_hours}h</p>
                )}
              </div>
            )}

            {job.permit_required && (
              <div>
                <p className="text-sm text-gray-500">{t('permit')}</p>
                <p className="text-gray-900">
                  {job.permit_number || t('required')} 
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                    job.permit_status === 'approved' ? 'bg-green-100 text-green-700' :
                    job.permit_status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {job.permit_status}
                  </span>
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Product & Scope */}
        {(job.product_summary || job.scope_of_work) && (
          <div className="bg-white rounded-lg shadow-sm border p-4">
            <h2 className="font-semibold text-gray-900 mb-3">{t('scopeOfWork')}</h2>
            
            {job.product_summary && (
              <div className="mb-3">
                <p className="text-sm text-gray-500">{t('product')}</p>
                <p className="text-gray-900">{job.product_summary}</p>
              </div>
            )}

            {job.scope_of_work && (
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{job.scope_of_work}</p>
              </div>
            )}
          </div>
        )}

        {/* Special Instructions */}
        {job.special_instructions && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h2 className="font-semibold text-yellow-800 mb-2">{t('specialInstructions')}</h2>
            <p className="text-sm text-yellow-700 whitespace-pre-wrap">{job.special_instructions}</p>
          </div>
        )}

        {/* Line Items */}
        {job.line_items.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border p-4">
            <h2 className="font-semibold text-gray-900 mb-3">{t('workItems')}</h2>
            <div className="space-y-3">
              {Object.entries(groupedItems).map(([category, items]) => (
                <div key={category}>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{category}</p>
                  <div className="space-y-1">
                    {items.map(item => (
                      <div key={item.id} className="flex justify-between py-1 border-b border-gray-100 last:border-0">
                        <div>
                          <p className="text-sm text-gray-900">{item.name}</p>
                          {item.description && (
                            <p className="text-xs text-gray-500">{item.description}</p>
                          )}
                        </div>
                        <p className="text-sm text-gray-600">{item.quantity} {item.unit}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {job.notes.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border p-4">
            <h2 className="font-semibold text-gray-900 mb-3">{t('notes')}</h2>
            <div className="space-y-2">
              {job.notes.map(note => (
                <div key={note.id} className="bg-gray-50 p-3 rounded-lg">
                  <p className="text-sm text-gray-700">{note.note}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(note.created_at).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Files & Photos */}
        {job.files.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border p-4">
            <h2 className="font-semibold text-gray-900 mb-3">{t('filesAndPhotos')}</h2>
            <div className="grid grid-cols-3 gap-2">
              {job.files.map(file => {
                const isImage = file.mime_type?.startsWith('image/')
                const fileUrl = `${supabaseUrl}/storage/v1/object/public/files/${file.storage_path}`
                
                return isImage ? (
                  <a
                    key={file.id}
                    href={fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="aspect-square bg-gray-100 rounded overflow-hidden"
                  >
                    <img
                      src={fileUrl}
                      alt={file.file_name}
                      className="w-full h-full object-cover"
                    />
                  </a>
                ) : (
                  <a
                    key={file.id}
                    href={fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="aspect-square bg-gray-100 rounded flex items-center justify-center"
                  >
                    <div className="text-center p-2">
                      <svg className="w-8 h-8 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="text-xs text-gray-500 truncate mt-1">{file.file_name}</p>
                    </div>
                  </a>
                )
              })}
            </div>
          </div>
        )}

        {/* Job Packet Download */}
        {job.job_packet_pdf_path && (
          <div className="bg-white rounded-lg shadow-sm border p-4">
            <a
              href={`${supabaseUrl}/storage/v1/object/public/job-files/${job.job_packet_pdf_path}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full bg-gray-100 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-200 min-h-[44px]"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {t('downloadJobPacket')}
            </a>
          </div>
        )}
      </main>

      {/* Complete Modal */}
      {showCompleteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('completeJob')}</h2>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('completionNotesOptional')}
              </label>
              <textarea
                value={completionNotes}
                onChange={(e) => setCompletionNotes(e.target.value)}
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
                placeholder={t('anyNotesPlaceholder')}
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowCompleteModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 min-h-[44px]"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleCompleteJob}
                disabled={updating}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 min-h-[44px]"
              >
                {updating ? t('completing') : t('markComplete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
