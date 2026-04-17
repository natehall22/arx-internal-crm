'use client'

import { useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'

export type JobPhotoLightboxEntry = {
  id: string
  filename: string
  /** Shown under the filename (e.g. tag label) */
  caption?: string | null
}

type JobPhotoLightboxProps = {
  jobId: string
  photos: JobPhotoLightboxEntry[]
  open: boolean
  index: number
  onClose: () => void
  onIndexChange: (index: number) => void
}

function photoSrc(jobId: string, photoId: string) {
  return `/api/ops/jobs/${jobId}/photos/${photoId}/download`
}

export default function JobPhotoLightbox({
  jobId,
  photos,
  open,
  index,
  onClose,
  onIndexChange,
}: JobPhotoLightboxProps) {
  const wrapCount = photos.length
  const safeIndex = wrapCount > 0 ? Math.min(Math.max(0, index), wrapCount - 1) : 0
  const current = photos[safeIndex]
  const touchStartX = useRef<number | null>(null)

  const goPrev = useCallback(() => {
    if (wrapCount < 2) return
    onIndexChange(safeIndex <= 0 ? wrapCount - 1 : safeIndex - 1)
  }, [wrapCount, safeIndex, onIndexChange])

  const goNext = useCallback(() => {
    if (wrapCount < 2) return
    onIndexChange(safeIndex >= wrapCount - 1 ? 0 : safeIndex + 1)
  }, [wrapCount, safeIndex, onIndexChange])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNext()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, goPrev, goNext])

  if (!open || wrapCount === 0 || typeof document === 'undefined') {
    return null
  }

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.changedTouches[0]?.clientX ?? null
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartX.current
    touchStartX.current = null
    if (start == null) return
    const end = e.changedTouches[0]?.clientX
    if (end == null) return
    const dx = end - start
    if (Math.abs(dx) < 48) return
    if (dx > 0) goPrev()
    else goNext()
  }

  return createPortal(
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Photo viewer">
      <button
        type="button"
        aria-label="Close photo viewer"
        className="absolute inset-0 bg-black/90"
        onClick={onClose}
      />
      <div className="relative flex h-full w-full items-center justify-center p-2 sm:p-4 pointer-events-none">
        <div
          className="pointer-events-auto flex max-h-full w-full max-w-6xl flex-col"
          onClick={(e) => e.stopPropagation()}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
        <div className="flex w-full max-w-6xl flex-shrink-0 items-center justify-between gap-2 pb-2 text-white">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40"
          >
            Close
            <span className="ml-2 hidden sm:inline text-white/50">(Esc)</span>
          </button>
          <div className="text-center text-sm text-white/80">
            {safeIndex + 1} / {wrapCount}
          </div>
          <a
            href={photoSrc(jobId, current.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg px-3 py-2 text-sm font-medium text-indigo-200 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40"
          >
            Open file
          </a>
        </div>

        <div className="relative flex min-h-0 w-full max-w-6xl flex-1 items-center justify-center">
          {wrapCount > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                goPrev()
              }}
              className="absolute left-0 z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-white shadow-lg backdrop-blur-sm transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/50 sm:left-1 sm:h-14 sm:w-14"
              aria-label="Previous photo"
            >
              <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          <div className="mx-12 flex min-h-0 max-h-full w-full items-center justify-center sm:mx-16">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoSrc(jobId, current.id)}
              alt={current.filename}
              className="max-h-[min(78vh,920px)] w-auto max-w-full object-contain select-none"
              draggable={false}
            />
          </div>

          {wrapCount > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                goNext()
              }}
              className="absolute right-0 z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-white shadow-lg backdrop-blur-sm transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/50 sm:right-1 sm:h-14 sm:w-14"
              aria-label="Next photo"
            >
              <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>

        <div className="mt-2 w-full flex-shrink-0 rounded-lg bg-black/40 px-3 py-2 text-center text-sm text-white/90">
          <div className="font-medium break-words">{current.filename}</div>
          {current.caption ? (
            <div className="mt-0.5 text-xs text-white/60">{current.caption}</div>
          ) : null}
          <p className="mt-1 text-xs text-white/45">← → keys · swipe · tap dark area to close</p>
        </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
