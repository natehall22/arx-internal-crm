'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import PhotoLightbox from '@/components/PhotoLightbox'
import { jobPhotoDownloadUrl } from '@/lib/ops-job-photo-url'
import { createClientBrowser } from '@/lib/supabase/client'
import { multipartFilenameForUpload } from '@/lib/files/storage'
import { FINAL_PHOTO_TAGS, REQUIRED_FINAL_PHOTO_TAGS, finalPhotoTagLabel } from '@/lib/final-photo-tags'
import { TRADE_LABELS, type Trade } from '@/lib/job-trades'

interface FinalPhoto {
  id: string
  filename: string
  photo_tag: string | null
  created_at: string
  work_order_id: string | null
}

interface FinalPhotosCardProps {
  jobId: string
  /** The job's crews, from Schedule & Crews. Each needs its own 4 walk-around photos. */
  trades: { id: string; trade: Trade; status: string }[]
}

/** Photos not tied to a crew (uploaded before trades existed, or by ops without picking one). */
const JOB_LEVEL = 'job'

/**
 * Final photos, PER CREW. Crews normally shoot these from the photo link in
 * their calendar invite; ops can add or fill gaps here. The 4 required angles
 * are required for each trade — the siding crew shows the siding.
 */
export default function FinalPhotosCard({ jobId, trades }: FinalPhotosCardProps) {
  const [loading, setLoading] = useState(true)
  const [photos, setPhotos] = useState<FinalPhoto[]>([])
  const [uploading, setUploading] = useState(false)
  const [selectedTag, setSelectedTag] = useState<string>('final_front')
  const [selectedTradeId, setSelectedTradeId] = useState<string>(JOB_LEVEL)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Default the upload target to the first crew once crews load.
  useEffect(() => {
    if (selectedTradeId === JOB_LEVEL && trades.length > 0) setSelectedTradeId(trades[0].id)
    if (selectedTradeId !== JOB_LEVEL && !trades.some((t) => t.id === selectedTradeId)) {
      setSelectedTradeId(trades[0]?.id ?? JOB_LEVEL)
    }
  }, [trades, selectedTradeId])

  const loadPhotos = useCallback(async () => {
    try {
      const response = await fetch(`/api/ops/jobs/${jobId}/photos`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Failed to load photos')
      setPhotos((data.photos || []) as FinalPhoto[])
    } catch (err) {
      console.error('Load photos error:', err)
      setPhotos([])
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    void loadPhotos()
  }, [loadPhotos])

  // Every job photo stays visible here, as before; only the checklist counts final tags.
  const finalPhotos = photos

  const lightboxEntries = useMemo(
    () =>
      finalPhotos.map((p) => {
        const trade = trades.find((t) => t.id === p.work_order_id)
        return {
          id: p.id,
          src: jobPhotoDownloadUrl(jobId, p.id),
          href: jobPhotoDownloadUrl(jobId, p.id),
          title: p.filename,
          caption: [trade ? TRADE_LABELS[trade.trade] : null, finalPhotoTagLabel(p.photo_tag)].filter(Boolean).join(' · ') || null,
        }
      }),
    [finalPhotos, jobId, trades]
  )

  const tagsByTrade = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const p of finalPhotos) {
      const key = p.work_order_id ?? JOB_LEVEL
      const set = map.get(key) ?? new Set<string>()
      if (p.photo_tag) set.add(p.photo_tag)
      map.set(key, set)
    }
    return map
  }, [finalPhotos])

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      // Direct to storage (register → upload → finalize): phone photos exceed the
      // ~4.5MB request limit a multipart POST through the API route would hit.
      const regRes = await fetch(`/api/ops/jobs/${jobId}/photos/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: multipartFilenameForUpload(file, 'photo') }),
      })
      const reg = await regRes.json().catch(() => ({}))
      if (!regRes.ok) throw new Error(reg.error || 'Failed to start upload')

      const { error: uploadError } = await createClientBrowser()
        .storage.from(String(reg.bucket))
        .uploadToSignedUrl(String(reg.storagePath), String(reg.signedUploadToken), file, {
          contentType: file.type || 'application/octet-stream',
        })
      if (uploadError) throw new Error(uploadError.message)

      const finRes = await fetch(`/api/ops/jobs/${jobId}/photos/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photoId: reg.photoId,
          photo_tag: selectedTag,
          mime_type: file.type || null,
          file_size: file.size,
          work_order_id: selectedTradeId === JOB_LEVEL ? null : selectedTradeId,
        }),
      })
      const fin = await finRes.json().catch(() => ({}))
      if (!finRes.ok) throw new Error(fin.error || 'Failed to save photo')
      await loadPhotos()
    } catch (err) {
      console.error('Upload error:', err)
      alert(err instanceof Error ? err.message : 'Failed to upload photo')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const checklistRows: { key: string; label: string }[] =
    trades.length > 0
      ? trades.map((t) => ({ key: t.id, label: TRADE_LABELS[t.trade] }))
      : [{ key: JOB_LEVEL, label: 'Job' }]
  const selectedTags = tagsByTrade.get(selectedTradeId) ?? new Set<string>()
  const allRequiredDone = checklistRows.every((row) =>
    REQUIRED_FINAL_PHOTO_TAGS.every((tag) => tagsByTrade.get(row.key)?.has(tag))
  )

  return (
    <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base sm:text-lg font-semibold text-[#2c2c2a]">Final Photos</h2>
        <span
          className={`text-xs px-2 py-1 rounded-full font-medium ${
            allRequiredDone ? 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200' : 'bg-amber-100 text-amber-900'
          }`}
        >
          4 per crew
        </span>
      </div>

      <ul className="mb-4 space-y-1.5">
        {checklistRows.map((row) => {
          const have = REQUIRED_FINAL_PHOTO_TAGS.filter((tag) => tagsByTrade.get(row.key)?.has(tag)).length
          return (
            <li key={row.key} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <span className="font-medium text-[#2c2c2a]">{row.label}</span>
              <span className={have === 4 ? 'font-semibold text-emerald-800' : 'text-[#57574f]'}>{have}/4</span>
            </li>
          )
        })}
      </ul>

      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
        <div className="flex flex-col sm:flex-row gap-3">
          {trades.length > 0 && (
            <select
              aria-label="Crew"
              value={selectedTradeId}
              onChange={(e) => setSelectedTradeId(e.target.value)}
              className="min-h-[44px] text-base sm:text-sm border-gray-300 rounded-md shadow-sm text-[#2c2c2a]"
            >
              {trades.map((t) => (
                <option key={t.id} value={t.id}>
                  {TRADE_LABELS[t.trade]}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="Photo"
            value={selectedTag}
            onChange={(e) => setSelectedTag(e.target.value)}
            className="min-h-[44px] text-base sm:text-sm border-gray-300 rounded-md shadow-sm text-[#2c2c2a]"
          >
            {FINAL_PHOTO_TAGS.map((tag) => (
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
            <span
              className={`min-h-[44px] w-full sm:w-auto inline-flex items-center justify-center px-4 py-2.5 text-sm font-medium rounded-lg cursor-pointer ${
                uploading ? 'bg-gray-300 text-gray-600' : 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800'
              }`}
            >
              {uploading ? 'Uploading...' : '📷 Upload Photo'}
            </span>
          </label>
        </div>
      </div>

      <div className="mb-4">
        <h3 className="text-sm font-medium text-[#2c2c2a] mb-2">
          Checklist{trades.length > 1 ? ` — ${TRADE_LABELS[trades.find((t) => t.id === selectedTradeId)?.trade ?? 'roofing']}` : ''}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {FINAL_PHOTO_TAGS.slice(0, 8).map((tag) => {
            const hasPhoto = selectedTags.has(tag.value)
            const isRequired = (REQUIRED_FINAL_PHOTO_TAGS as readonly string[]).includes(tag.value)
            return (
              <button
                key={tag.value}
                type="button"
                onClick={() => {
                  setSelectedTag(tag.value)
                  fileInputRef.current?.click()
                }}
                className={`min-h-[44px] flex items-center gap-2 p-3 rounded-lg text-sm text-left transition-colors ${
                  hasPhoto
                    ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                    : isRequired
                      ? 'bg-amber-50 text-amber-900 border border-amber-200'
                      : 'bg-gray-50 text-[#57574f] border border-gray-200'
                }`}
              >
                <span aria-hidden className="w-5 text-center">
                  {hasPhoto ? '✓' : '📷'}
                </span>
                <span className={`truncate ${isRequired ? 'font-medium text-[#2c2c2a]' : ''}`}>{tag.label}</span>
                {isRequired && !hasPhoto && <span className="text-xs ml-auto text-amber-800">*</span>}
              </button>
            )
          })}
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="aspect-square bg-gray-200 rounded"></div>
          ))}
        </div>
      ) : finalPhotos.length > 0 ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            {finalPhotos.map((photo, i) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => {
                  setLightboxIndex(i)
                  setLightboxOpen(true)
                }}
                className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden group min-h-[80px] w-full text-left ring-offset-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <img
                  src={jobPhotoDownloadUrl(jobId, photo.id)}
                  alt={photo.filename}
                  className="w-full h-full object-cover pointer-events-none"
                  loading="lazy"
                />
                <div className="absolute inset-x-0 bottom-0 pointer-events-none">
                  <span className="block w-full px-1.5 py-1 bg-black/70 text-white text-xs truncate">
                    {lightboxEntries[i]?.caption}
                  </span>
                </div>
              </button>
            ))}
          </div>
          <PhotoLightbox
            photos={lightboxEntries}
            open={lightboxOpen}
            index={lightboxIndex}
            onClose={() => setLightboxOpen(false)}
            onIndexChange={setLightboxIndex}
          />
        </>
      ) : (
        <p className="text-sm text-[#57574f] text-center py-4">
          No final photos yet. Crews add them from the photo link in their calendar invite.
        </p>
      )}
    </div>
  )
}
