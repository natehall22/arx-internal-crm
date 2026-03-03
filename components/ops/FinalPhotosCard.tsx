'use client'

import { useState, useEffect, useRef } from 'react'
import { createClientBrowser } from '@/lib/supabase/client'

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
  file_name: string
  storage_path: string
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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  useEffect(() => {
    loadPhotos()
  }, [jobId, projectId])

  const loadPhotos = async () => {
    const supabase = createClientBrowser()

    // Load photos tagged as final photos for this job or project
    const { data } = await supabase
      .from('files')
      .select('id, file_name, storage_path, photo_tag, created_at')
      .or(`job_id.eq.${jobId},project_id.eq.${projectId}`)
      .like('photo_tag', 'final_%')
      .order('created_at', { ascending: false })

    setPhotos(data || [])
    setLoading(false)
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    const supabase = createClientBrowser()

    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `${selectedTag}_${Date.now()}.${fileExt}`
      const storagePath = `${orgId}/jobs/${jobId}/final/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('files')
        .upload(storagePath, file)

      if (uploadError) throw uploadError

      const { error: insertError } = await supabase
        .from('files')
        .insert({
          org_id: orgId,
          job_id: jobId,
          project_id: projectId,
          file_name: file.name,
          storage_path: storagePath,
          mime_type: file.type,
          photo_tag: selectedTag,
          tag: 'final_photo',
        })

      if (insertError) throw insertError

      await loadPhotos()
    } catch (err) {
      console.error('Upload error:', err)
      alert('Failed to upload photo')
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
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Final Photos</h2>
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

      {/* Upload Section */}
      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
        <div className="flex items-center gap-3">
          <select
            value={selectedTag}
            onChange={(e) => setSelectedTag(e.target.value)}
            className="text-sm border-gray-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
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
              onChange={handleUpload}
              disabled={uploading}
              className="hidden"
            />
            <span className={`inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md cursor-pointer ${
              uploading 
                ? 'bg-gray-300 text-gray-500' 
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}>
              {uploading ? 'Uploading...' : 'Upload Photo'}
            </span>
          </label>
        </div>
      </div>

      {/* Photo Checklist */}
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Photo Checklist</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {PHOTO_TAGS.slice(0, 8).map(tag => {
            const hasPhoto = photosByTag[tag.value]?.length > 0
            const isRequired = requiredTags.includes(tag.value)
            return (
              <div 
                key={tag.value}
                className={`flex items-center gap-2 p-2 rounded text-sm ${
                  hasPhoto 
                    ? 'bg-green-50 text-green-700' 
                    : isRequired 
                      ? 'bg-yellow-50 text-yellow-700' 
                      : 'bg-gray-50 text-gray-500'
                }`}
              >
                {hasPhoto ? (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                )}
                <span className="truncate">{tag.label}</span>
                {isRequired && !hasPhoto && <span className="text-xs">*</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Photo Grid */}
      {loading ? (
        <div className="animate-pulse grid grid-cols-3 gap-2">
          {[1,2,3].map(i => (
            <div key={i} className="aspect-square bg-gray-200 rounded"></div>
          ))}
        </div>
      ) : photos.length > 0 ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {photos.map(photo => (
            <a
              key={photo.id}
              href={`${supabaseUrl}/storage/v1/object/public/files/${photo.storage_path}`}
              target="_blank"
              rel="noopener noreferrer"
              className="relative aspect-square bg-gray-100 rounded overflow-hidden group"
            >
              <img
                src={`${supabaseUrl}/storage/v1/object/public/files/${photo.storage_path}`}
                alt={photo.file_name}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all flex items-end">
                <span className="w-full px-1 py-0.5 bg-black bg-opacity-50 text-white text-xs truncate">
                  {PHOTO_TAGS.find(t => t.value === photo.photo_tag)?.label || photo.photo_tag}
                </span>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500 text-center py-4">
          No final photos uploaded yet. Upload photos to complete the checklist.
        </p>
      )}
    </div>
  )
}
