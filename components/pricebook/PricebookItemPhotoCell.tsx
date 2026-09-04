'use client'

import { useRef, useState } from 'react'

interface Props {
  itemId: string
  itemName: string
  initialImageUrl: string | null
  canEdit: boolean
}

export default function PricebookItemPhotoCell({ itemId, itemName, initialImageUrl, canEdit }: Props) {
  const [imageUrl, setImageUrl] = useState(initialImageUrl)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setBusy(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/admin/pricing/items/${itemId}/image`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setImageUrl(data.image_url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    if (!confirm(`Remove photo for "${itemName}"?`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/pricing/items/${itemId}/image`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Remove failed')
      setImageUrl(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  const thumbnail = (
    <div className="w-10 h-10 rounded-md border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center flex-shrink-0">
      {imageUrl ? (
        <img src={imageUrl} alt={itemName} className="w-full h-full object-cover" />
      ) : (
        <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M4 8h16M4 4h16v16H4V4z" />
        </svg>
      )}
    </div>
  )

  if (!canEdit) {
    return thumbnail
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        className="disabled:opacity-50"
        title="Click to change photo"
      >
        {thumbnail}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFileChange}
        className="hidden"
      />
      <div className="flex flex-col text-xs">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="text-indigo-600 hover:text-indigo-800 text-left disabled:opacity-50"
        >
          {busy ? 'Uploading…' : imageUrl ? 'Change' : 'Add photo'}
        </button>
        {imageUrl && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            className="text-red-500 hover:text-red-700 text-left disabled:opacity-50"
          >
            Remove
          </button>
        )}
        {error && <span className="text-red-600">{error}</span>}
      </div>
    </div>
  )
}
