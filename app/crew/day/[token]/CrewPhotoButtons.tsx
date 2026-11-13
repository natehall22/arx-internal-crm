'use client'

import * as React from 'react'

import { FileDropZone } from '@/components/ui/file-drop-zone'

/**
 * The crew's two ways to add photos on a visit: "Take photo" (the phone camera, one shot) and "Choose photos" (the library,
 * several at once; also drag and drop). Both are 44px+ tap targets. Hands the files to `onFiles`; the page uploads them.
 */
export function CrewPhotoButtons({
  onFiles,
  disabled = false,
  savedCount = 0,
  busyLabel = 'Saving…',
  busy = false,
  className,
}: {
  onFiles: (files: File[]) => void
  disabled?: boolean
  savedCount?: number
  busy?: boolean
  busyLabel?: string
  className?: string
}) {
  const cameraRef = React.useRef<HTMLInputElement>(null)
  const saved = savedCount ? ` (${savedCount} saved)` : ''
  return (
    <div className={`grid grid-cols-2 gap-2 ${className ?? ''}`} data-testid="crew-photo-buttons">
      <button
        type="button"
        disabled={disabled}
        onClick={() => cameraRef.current?.click()}
        className="flex min-h-[2.75rem] w-full items-center justify-center rounded-lg border-2 border-[#2c2c2a] bg-white px-3 py-2 text-base font-semibold text-[#2c2c2a] disabled:opacity-50"
      >
        {busy ? busyLabel : `Take photo${saved}`}
      </button>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        tabIndex={-1}
        aria-hidden
        data-testid="crew-photo-camera"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files).filter((f) => f.size > 0) : []
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
      <FileDropZone compact accept="image/*" multiple disabled={disabled} label="Choose photos" className="w-full" onFiles={onFiles} />
    </div>
  )
}
