'use client'

import { useRef, type Dispatch, type SetStateAction } from 'react'

export const MIN_PHOTOS = 6
export const MAX_PHOTOS = 20
const MAX_MP = 2_000_000
const TARGET_BYTES = 800_000

export type UploadedPhoto = {
  id: string
  filename: string
  previewUrl: string
  storagePath?: string
  uploading: boolean
  error?: string
}

export const CLOSE_VISIT_DEBRIEF_ROLES = new Set([
  'admin',
  'owner',
  'setter_manager',
  'regional_setter_manager',
  'sales_manager',
  'regional_manager',
  'rep',
])

export function canSubmitCloseVisitDebrief(role: string | null | undefined): boolean {
  return !!role && CLOSE_VISIT_DEBRIEF_ROLES.has(role)
}

export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const { width: origW, height: origH } = bitmap

  let w = origW
  let h = origH
  const px = origW * origH
  if (px > MAX_MP) {
    const scale = Math.sqrt(MAX_MP / px)
    w = Math.round(origW * scale)
    h = Math.round(origH * scale)
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  for (const quality of [0.82, 0.65, 0.5]) {
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        quality
      )
    )
    if (blob.size <= TARGET_BYTES || quality === 0.5) return blob
  }
  return new Blob()
}

export function BoolToggle({
  label,
  value,
  onChange,
  required,
}: {
  label: string
  value: boolean | null
  onChange: (v: boolean) => void
  required?: boolean
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
            value === true
              ? 'bg-green-600 border-green-600 text-white'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
            value === false
              ? 'bg-red-600 border-red-600 text-white'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          No
        </button>
      </div>
    </div>
  )
}

export function Detail({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <span className="text-gray-500 text-xs block">{label}</span>
      <span className="text-gray-800 text-sm">{value}</span>
    </div>
  )
}

export function boolDisplay(v: boolean | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return v ? 'Yes' : 'No'
}

export function CloseVisitPhotoUpload({
  opportunityId,
  photos,
  onPhotosChange,
}: {
  opportunityId: string
  photos: UploadedPhoto[]
  onPhotosChange: Dispatch<SetStateAction<UploadedPhoto[]>>
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadedCount = photos.filter((p) => p.storagePath && !p.uploading).length
  const uploadingCount = photos.filter((p) => p.uploading).length
  const canAddMore = photos.length < MAX_PHOTOS

  async function handleFiles(files: FileList) {
    const remaining = MAX_PHOTOS - photos.length
    const toProcess = Array.from(files).slice(0, remaining)

    const placeholders: UploadedPhoto[] = toProcess.map((f) => ({
      id: crypto.randomUUID(),
      filename: f.name,
      previewUrl: URL.createObjectURL(f),
      uploading: true,
    }))
    onPhotosChange([...photos, ...placeholders])

    await Promise.all(
      toProcess.map(async (file, i) => {
        const placeholder = placeholders[i]
        try {
          const compressed = await compressImage(file)
          const fd = new FormData()
          fd.append('file', compressed, file.name.replace(/\.[^.]+$/, '.jpg'))

          const res = await fetch(`/api/opportunities/${opportunityId}/inspection-photos`, {
            method: 'POST',
            body: fd,
          })

          if (!res.ok) {
            const d = await res.json()
            onPhotosChange((prev) =>
              prev.map((p) =>
                p.id === placeholder.id ? { ...p, uploading: false, error: d.error || 'Upload failed' } : p
              )
            )
            return
          }

          const { photo } = await res.json()
          onPhotosChange((prev) =>
            prev.map((p) =>
              p.id === placeholder.id
                ? { ...p, id: photo.id, storagePath: photo.storage_path, uploading: false }
                : p
            )
          )
        } catch {
          onPhotosChange((prev) =>
            prev.map((p) =>
              p.id === placeholder.id ? { ...p, uploading: false, error: 'Upload failed' } : p
            )
          )
        }
      })
    )
  }

  async function removePhoto(photo: UploadedPhoto) {
    if (photo.storagePath) {
      await fetch(`/api/opportunities/${opportunityId}/inspection-photos/${photo.id}`, {
        method: 'DELETE',
      }).catch(() => {})
    }
    if (photo.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(photo.previewUrl)
    }
    onPhotosChange(photos.filter((p) => p.id !== photo.id))
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-gray-700">
          Close visit photos
          <span className="text-red-500 ml-0.5">*</span>
          <span className="text-gray-400 font-normal ml-1">
            (min {MIN_PHOTOS}, max {MAX_PHOTOS})
          </span>
        </label>
        <span
          className={`text-xs font-semibold ${
            uploadedCount >= MIN_PHOTOS ? 'text-green-600' : 'text-amber-600'
          }`}
        >
          {uploadedCount} / {MIN_PHOTOS} required
        </span>
      </div>

      {photos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-3">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 border border-gray-200"
            >
              {photo.previewUrl ? (
                <img src={photo.previewUrl} alt={photo.filename} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center p-1 text-center text-[10px] text-gray-500 leading-tight">
                  No preview
                </div>
              )}
              {photo.uploading && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {photo.error && (
                <div className="absolute inset-0 bg-red-500/70 flex items-center justify-center p-1">
                  <span className="text-white text-xs text-center leading-tight">Failed</span>
                </div>
              )}
              {!photo.uploading && (
                <button
                  type="button"
                  onClick={() => removePhoto(photo)}
                  className="absolute top-1 right-1 w-5 h-5 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center text-xs leading-none"
                  aria-label="Remove photo"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canAddMore && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploadingCount > 0}
            className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-indigo-400 hover:text-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploadingCount > 0
              ? `Uploading ${uploadingCount} photo${uploadingCount > 1 ? 's' : ''}…`
              : `+ Add photos${photos.length > 0 ? ` (${MAX_PHOTOS - photos.length} remaining)` : ''}`}
          </button>
        </>
      )}

      {uploadedCount < MIN_PHOTOS && photos.length > 0 && uploadingCount === 0 && (
        <p className="text-xs text-amber-600 mt-2">
          Add {MIN_PHOTOS - uploadedCount} more photo{MIN_PHOTOS - uploadedCount > 1 ? 's' : ''} to continue.
        </p>
      )}
    </div>
  )
}
