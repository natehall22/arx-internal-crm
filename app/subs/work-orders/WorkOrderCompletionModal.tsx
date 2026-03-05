'use client'

import { useState, useRef } from 'react'
import { useSubPortalLanguage } from '@/lib/i18n/SubPortalLanguageContext'

interface WorkOrder {
  id: string
  work_order_number: string
  title: string
  full_address: string
}

interface WorkOrderCompletionModalProps {
  workOrder: WorkOrder
  onClose: () => void
  onSuccess: () => void
}

interface PhotoPreview {
  file: File
  preview: string
  type: 'work_done' | 'cleanup'
}

export default function WorkOrderCompletionModal({ 
  workOrder, 
  onClose, 
  onSuccess 
}: WorkOrderCompletionModalProps) {
  const { t } = useSubPortalLanguage()
  const [completionNote, setCompletionNote] = useState('')
  const [workDonePhotos, setWorkDonePhotos] = useState<PhotoPreview[]>([])
  const [cleanupPhotos, setCleanupPhotos] = useState<PhotoPreview[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const workDoneInputRef = useRef<HTMLInputElement>(null)
  const cleanupInputRef = useRef<HTMLInputElement>(null)

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>, type: 'work_done' | 'cleanup') => {
    const files = e.target.files
    if (!files) return

    const newPhotos: PhotoPreview[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file.type.startsWith('image/')) {
        newPhotos.push({
          file,
          preview: URL.createObjectURL(file),
          type,
        })
      }
    }

    if (type === 'work_done') {
      setWorkDonePhotos(prev => [...prev, ...newPhotos])
    } else {
      setCleanupPhotos(prev => [...prev, ...newPhotos])
    }

    e.target.value = ''
  }

  const removePhoto = (index: number, type: 'work_done' | 'cleanup') => {
    if (type === 'work_done') {
      setWorkDonePhotos(prev => {
        const newPhotos = [...prev]
        URL.revokeObjectURL(newPhotos[index].preview)
        newPhotos.splice(index, 1)
        return newPhotos
      })
    } else {
      setCleanupPhotos(prev => {
        const newPhotos = [...prev]
        URL.revokeObjectURL(newPhotos[index].preview)
        newPhotos.splice(index, 1)
        return newPhotos
      })
    }
  }

  const handleSubmit = async () => {
    setError(null)

    if (!completionNote.trim()) {
      setError(t('completionNoteRequired'))
      return
    }

    if (workDonePhotos.length === 0) {
      setError(t('workDonePhotoRequired'))
      return
    }

    if (cleanupPhotos.length === 0) {
      setError(t('cleanupPhotoRequired'))
      return
    }

    setSubmitting(true)

    try {
      const formData = new FormData()
      formData.append('completion_note', completionNote)
      
      workDonePhotos.forEach((photo, index) => {
        formData.append(`work_done_photo_${index}`, photo.file)
      })
      
      cleanupPhotos.forEach((photo, index) => {
        formData.append(`cleanup_photo_${index}`, photo.file)
      })

      const response = await fetch(`/api/subs/work-orders/${workOrder.id}/complete`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || t('errorSubmitting'))
      }

      setSuccess(true)
      setTimeout(() => {
        onSuccess()
      }, 1500)

    } catch (err: any) {
      setError(err.message || t('errorSubmitting'))
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900">{t('submittedSuccessfully')}</h2>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">{t('completeWorkOrder')}</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-1">{workOrder.work_order_number} - {workOrder.title}</p>
        </div>

        <div className="p-6 space-y-6">
          {/* Completion Note */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('completionNote')} *
            </label>
            <textarea
              value={completionNote}
              onChange={(e) => setCompletionNote(e.target.value)}
              rows={4}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500"
              placeholder={t('completionNotePlaceholder')}
            />
          </div>

          {/* Work Done Photos */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('workDonePhotos')} * ({workDonePhotos.length})
            </label>
            
            <input
              ref={workDoneInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={(e) => handlePhotoSelect(e, 'work_done')}
              className="hidden"
            />

            <div className="grid grid-cols-3 gap-2 mb-2">
              {workDonePhotos.map((photo, index) => (
                <div key={index} className="relative aspect-square">
                  <img
                    src={photo.preview}
                    alt={`Work done ${index + 1}`}
                    className="w-full h-full object-cover rounded-lg"
                  />
                  <button
                    onClick={() => removePhoto(index, 'work_done')}
                    className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-xs"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={() => workDoneInputRef.current?.click()}
              className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-indigo-500 hover:text-indigo-600 min-h-[44px] flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {t('addWorkDonePhoto')}
            </button>
          </div>

          {/* Cleanup Photos */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('cleanupPhotos')} * ({cleanupPhotos.length})
            </label>
            
            <input
              ref={cleanupInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={(e) => handlePhotoSelect(e, 'cleanup')}
              className="hidden"
            />

            <div className="grid grid-cols-3 gap-2 mb-2">
              {cleanupPhotos.map((photo, index) => (
                <div key={index} className="relative aspect-square">
                  <img
                    src={photo.preview}
                    alt={`Cleanup ${index + 1}`}
                    className="w-full h-full object-cover rounded-lg"
                  />
                  <button
                    onClick={() => removePhoto(index, 'cleanup')}
                    className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-xs"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={() => cleanupInputRef.current?.click()}
              className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-indigo-500 hover:text-indigo-600 min-h-[44px] flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {t('addCleanupPhoto')}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 min-h-[44px]"
          >
            {t('cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 min-h-[44px]"
          >
            {submitting ? t('submitting') : t('submitCompletion')}
          </button>
        </div>
      </div>
    </div>
  )
}
