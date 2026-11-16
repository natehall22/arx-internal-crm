'use client'

import Image from 'next/image'
import { useRef, useState } from 'react'
import { toast } from '@/components/ui/toast'

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml']
const MAX_BYTES = 2 * 1024 * 1024

export const SVG_LOGO_WARNING = "SVG logos won't appear on PDFs — upload a PNG for documents"

type Variant = 'main' | 'dark'

/** One picker: a drop zone (also tappable) on a white or dark swatch, the file picker, and Remove. */
function LogoPicker({ variant, label, hint, url, busy, svg, onFile, onRemove }: {
  variant: Variant
  label: string
  hint?: string
  url: string | null
  busy: boolean
  svg: boolean
  onFile: (file: File) => void
  onRemove: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const dark = variant === 'dark'
  const id = `logo-upload-${variant}`

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6" data-testid={`logo-picker-${variant}`}>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f && !busy) onFile(f)
        }}
        className={`relative h-32 w-full flex-shrink-0 overflow-hidden rounded-xl border-2 sm:w-32 ${dark ? 'bg-gray-900' : 'bg-white'} ${over ? 'border-indigo-500' : url ? 'border-gray-200' : 'border-dashed border-gray-300'}`}
        data-testid={`logo-swatch-${variant}`}
      >
        {url ? (
          <Image src={url} alt={dark ? 'Logo for dark backgrounds' : 'Company Logo'} fill className="object-contain p-2" unoptimized />
        ) : (
          <div className="flex h-full items-center justify-center px-2 text-center">
            <span className={`text-sm ${dark ? 'text-white' : 'text-gray-700'}`}>{over ? 'Drop to upload' : 'No logo. Drop a file here'}</span>
          </div>
        )}
      </div>
      <div className="flex-1">
        <p className="mb-2 text-sm font-medium text-gray-900">{label}</p>
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={ALLOWED_TYPES.join(',')}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = ''
          }}
          className="hidden"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="min-h-[44px] rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Uploading...' : url ? 'Change Logo' : 'Upload Logo'}
          </button>
          {url && (
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              className="min-h-[44px] rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
        {hint && <p className="mt-2 text-sm text-gray-700">{hint}</p>}
        {svg && <p className="mt-2 text-sm font-medium text-amber-800" role="alert">{SVG_LOGO_WARNING}</p>}
      </div>
    </div>
  )
}

/**
 * Settings → Company Logo. The main logo (documents, white surfaces) and the optional logo for dark backgrounds (app nav,
 * dark proposal theme), both through `/api/admin/logo` (`variant=dark` for the second).
 */
export default function CompanyLogoCard({ initialLogoUrl, initialDarkLogoUrl, confirmRemove }: {
  initialLogoUrl: string | null
  initialDarkLogoUrl: string | null
  confirmRemove: (what: string) => Promise<boolean>
}) {
  const [urls, setUrls] = useState<Record<Variant, string | null>>({ main: initialLogoUrl, dark: initialDarkLogoUrl })
  const [busy, setBusy] = useState<Variant | null>(null)
  const [svg, setSvg] = useState<Record<Variant, boolean>>({ main: false, dark: false })

  // Props load after the page's settings fetch; adopt them until the user has changed something here.
  const [synced, setSynced] = useState({ main: initialLogoUrl, dark: initialDarkLogoUrl })
  if (synced.main !== initialLogoUrl || synced.dark !== initialDarkLogoUrl) {
    setSynced({ main: initialLogoUrl, dark: initialDarkLogoUrl })
    setUrls({ main: initialLogoUrl, dark: initialDarkLogoUrl })
  }

  const query = (v: Variant) => (v === 'dark' ? '?variant=dark' : '')

  const upload = async (variant: Variant, file: File) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('Invalid file type. Please upload a PNG, JPG, WEBP, or SVG image.')
      return
    }
    if (file.size > MAX_BYTES) {
      toast('File too large. Maximum size is 2MB.')
      return
    }
    setBusy(variant)
    try {
      const formData = new FormData()
      formData.append('logo', file)
      if (variant === 'dark') formData.append('variant', 'dark')
      const response = await fetch('/api/admin/logo', { method: 'POST', body: formData })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        toast.error(data.error || 'Failed to upload logo')
        return
      }
      const data = await response.json()
      setUrls((u) => ({ ...u, [variant]: data.logo_url }))
      setSvg((s) => ({ ...s, [variant]: file.type === 'image/svg+xml' }))
      toast.success('Logo uploaded')
    } catch (error) {
      console.error('Error uploading logo:', error)
      toast.error('Failed to upload logo')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (variant: Variant) => {
    if (!(await confirmRemove(variant === 'dark' ? 'the logo for dark backgrounds' : 'the company logo'))) return
    setBusy(variant)
    try {
      const response = await fetch(`/api/admin/logo${query(variant)}`, { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        toast.error(data.error || 'Failed to remove logo')
        return
      }
      setUrls((u) => ({ ...u, [variant]: null }))
      setSvg((s) => ({ ...s, [variant]: false }))
      toast.success('Logo removed')
    } catch (error) {
      console.error('Error removing logo:', error)
      toast.error('Failed to remove logo')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mb-6 rounded-xl border bg-white p-6 shadow-sm" data-testid="company-logo-card">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">Company Logo</h2>
      <p className="mb-4 text-sm text-gray-700">
        Upload your company logo. This will be visible to all team members and can be used on proposals and documents.
      </p>
      <div className="flex flex-col gap-6">
        <LogoPicker
          variant="main"
          label="Logo (shown on white: documents, proposals)"
          hint="Accepted formats: PNG, JPG, WEBP, SVG. Max size: 2MB. Recommended: at least 200x200 pixels."
          url={urls.main}
          busy={busy !== null}
          svg={svg.main}
          onFile={(f) => upload('main', f)}
          onRemove={() => remove('main')}
        />
        <LogoPicker
          variant="dark"
          label="Logo for dark backgrounds (optional, e.g. all-white)"
          hint="Used in the app menu and on dark proposals. Without it, the main logo is used everywhere."
          url={urls.dark}
          busy={busy !== null}
          svg={svg.dark}
          onFile={(f) => upload('dark', f)}
          onRemove={() => remove('dark')}
        />
      </div>
    </div>
  )
}
