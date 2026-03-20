'use client'

import { useState, useEffect, useRef } from 'react'

const PHOTO_TAGS = [
  { value: 'final_front', label: 'Front' },
  { value: 'final_back', label: 'Back' },
  { value: 'final_left', label: 'Left Side' },
  { value: 'final_right', label: 'Right Side' },
  { value: 'final_slope_1', label: 'Slope 1' },
  { value: 'final_slope_2', label: 'Slope 2' },
  { value: 'flashing_detail', label: 'Flashing Detail' },
  { value: 'pipe_boots', label: 'Pipe Boots' },
  { value: 'cleanup', label: 'Cleanup' },
  { value: 'other_final', label: 'Other' },
]

interface FinalPhoto {
  id: string
  filename: string
  photo_tag: string | null
  created_at: string
}

interface FinalPhotosCardProps {
  jobId: string
  projectId: string
  orgId: string
}

export default function FinalPhotosCard({ jobId, projectId, orgId }: FinalPhotosCardProps) {
  const [loading, setLoading] = useState(true)
  const [photos, setPhotos] = useState<FinalPhoto[]>([])
  const [uploading, setUploading] = useState(false)
  const [selectedTag, setSelectedTag] = useState('final_front')
  const fileInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    loadPhotos()
  }, [jobId, projectId])

  const loadPhotos = async () => {
    try {
      const response = await fetch(`/api/ops/jobs/${jobId}/photos`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load photos')
      }
      setPhotos((data.photos || []) as FinalPhoto[])
    } catch (err) {
      console.error('Load photos error:', err)
      setPhotos([])
    } finally {
      setLoading(false)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)

    try {
      const formData = new FormData()
      formData.append('photo_tag', selectedTag)
      formData.append('file', file)

      const response = await fetch(`/api/ops/jobs/${jobId}/photos`, {
        method: 'POST',
        body: formData,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload photo')
      }

      await loadPhotos()
    } catch (err) {
      console.error('Upload error:', err)
      alert(err instanceof Error ? err.message : 'Failed to upload photo')
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // Group photos by tag
  const photosByTag = photos.reduce((acc, photo) => {
    const tag = photo.photo_tag || 'other_final'
    if (!acc[tag]) acc[tag] = []
    acc[tag].push(photo)
    return acc
  }, {} as Record<string, FinalPhoto[]>)

  // Calculate checklist completion
  const requiredTags = ['final_front', 'final_back', 'final_left', 'final_right']
  const completedRequired = requiredTags.filter(tag => photosByTag[tag]?.length > 0).length
  const checklistComplete = completedRequired === requiredTags.length

  return (
    <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900">Final Photos</h2>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded-full ${
            checklistComplete 
              ? 'bg-green-100 text-green-700' 
              : 'bg-yellow-100 text-yellow-700'
          }`}>
            {completedRequired}/{requiredTags.length} Required
          </span>
        </div>
      </div>

      {/* Upload Section - Mobile optimized */}
      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={selectedTag}
            onChange={(e) => setSelectedTag(e.target.value)}
            className="min-h-[44px] text-base sm:text-sm border-gray-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          >
            {PHOTO_TAGS.map(tag => (
              <option key={tag.value} value={tag.value}>
                {tag.label}
              </option>
            ))}
          </select>
          <label className="flex-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleUpload}
              disabled={uploading}
              className="hidden"
            />
            <span className={`min-h-[44px] w-full sm:w-auto inline-flex items-center justify-center px-4 py-2.5 text-sm font-medium rounded-lg cursor-pointer ${
              uploading 
                ? 'bg-gray-300 text-gray-500' 
                : 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800'
            }`}>
              {uploading ? 'Uploading...' : '📷 Upload Photo'}
            </span>
          </label>
        </div>
      </div>

      {/* Photo Checklist - Mobile optimized with larger touch targets */}
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Photo Checklist</h3>
        <div className="grid grid-cols-2 gap-2">
          {PHOTO_TAGS.slice(0, 8).map(tag => {
            const hasPhoto = photosByTag[tag.value]?.length > 0
            const isRequired = requiredTags.includes(tag.value)
            return (
              <button 
                key={tag.value}
                onClick={() => {
                  setSelectedTag(tag.value)
                  fileInputRef.current?.click()
                }}
                className={`min-h-[44px] flex items-center gap-2 p-3 rounded-lg text-sm text-left transition-colors ${
                  hasPhoto 
                    ? 'bg-green-50 text-green-700 border border-green-200' 
                    : isRequired 
                      ? 'bg-yellow-50 text-yellow-700 border border-yellow-200' 
                      : 'bg-gray-50 text-gray-600 border border-gray-200'
                }`}
              >
                {hasPhoto ? (
                  <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
                <span className="truncate font-medium">{tag.label}</span>
                {isRequired && !hasPhoto && <span className="text-xs ml-auto">*</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Photo Grid - Mobile optimized */}
      {loading ? (
        <div className="animate-pulse grid grid-cols-3 gap-2">
          {[1,2,3].map(i => (
            <div key={i} className="aspect-square bg-gray-200 rounded"></div>
          ))}
        </div>
      ) : photos.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {photos.map(photo => (
            <a
              key={photo.id}
              href={`/api/ops/jobs/${jobId}/photos/${photo.id}/download`}
              target="_blank"
              rel="noopener noreferrer"
              className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden group min-h-[80px]"
            >
              <img
                src={`/api/ops/jobs/${jobId}/photos/${photo.id}/download`}
                alt={photo.filename}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all flex items-end">
                <span className="w-full px-1.5 py-1 bg-black bg-opacity-60 text-white text-xs truncate">
                  {PHOTO_TAGS.find(t => t.value === photo.photo_tag)?.label || photo.photo_tag}
                </span>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500 text-center py-4">
          No final photos uploaded yet. Tap a checklist item above to take a photo.
        </p>
      )}
    </div>
  )
}
