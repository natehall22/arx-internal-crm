'use client'

import * as React from 'react'

import { cn } from '@/lib/cn'

/**
 * Drag-and-drop area that is also a normal file picker (tap / click / Enter / Space opens the picker), for every
 * "add files" control (Nathan: any upload supports drag and drop alongside the picker). Phone-first: the whole area is
 * a ≥44px button, no hover-only state. Hands the chosen files to `onFiles`; the caller uploads them.
 */
export function FileDropZone({
  onFiles,
  accept,
  multiple = true,
  disabled = false,
  label = 'Drop files here or tap to choose',
  hint,
  className,
}: {
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  disabled?: boolean
  label?: string
  hint?: string
  className?: string
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [over, setOver] = React.useState(false)
  const hintId = React.useId()

  const take = (list: FileList | null | undefined) => {
    const files = list ? Array.from(list).filter((f) => f.size > 0) : []
    if (files.length === 0) return
    onFiles(multiple ? files : files.slice(0, 1))
  }

  return (
    <div className={className}>
      <button
        type="button"
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setOver(true)
        }}
        onDragEnter={(e) => {
          e.preventDefault()
          if (!disabled) setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          if (!disabled) take(e.dataTransfer?.files)
        }}
        className={cn(
          'flex min-h-[5.5rem] w-full flex-col items-center justify-center gap-1 rounded-ui border-2 border-dashed px-4 py-4 text-center text-ui-base font-semibold text-ink',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-50',
          over ? 'border-brand-700 bg-brand-50' : 'border-surface-line bg-surface'
        )}
      >
        <span>{label}</span>
        {hint ? (
          <span id={hintId} className="text-ui-sm font-normal text-ink">
            {hint}
          </span>
        ) : null}
      </button>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          take(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
