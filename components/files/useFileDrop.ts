'use client'

import type { DragEvent } from 'react'
import { useCallback, useRef, useState } from 'react'

/** True when the drag carries files from the desktop (not text or a link dragged inside the page). */
export function dragHasFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')
}

/**
 * THE drag-and-drop behaviour for every "add files" area (Nathan's rule: any upload option takes drops as well as the picker).
 * Spread `bind` on the drop area; `active` is true while files hover over it. Nested children don't flicker the highlight
 * (enter/leave are depth-counted). Empty (0-byte) entries — folders dropped by some browsers — are skipped.
 */
export function useFileDrop(onFiles: (files: File[]) => void, opts: { disabled?: boolean } = {}) {
  const depth = useRef(0)
  const [active, setActive] = useState(false)
  const disabled = !!opts.disabled

  const reset = useCallback(() => {
    depth.current = 0
    setActive(false)
  }, [])

  const onDragEnter = useCallback(
    (e: DragEvent<HTMLElement>) => {
      if (disabled || !dragHasFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      depth.current += 1
      setActive(true)
    },
    [disabled]
  )

  const onDragLeave = useCallback((e: DragEvent<HTMLElement>) => {
    if (!dragHasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    depth.current -= 1
    if (depth.current <= 0) {
      depth.current = 0
      setActive(false)
    }
  }, [])

  const onDragOver = useCallback(
    (e: DragEvent<HTMLElement>) => {
      if (disabled || !dragHasFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
    },
    [disabled]
  )

  const onDrop = useCallback(
    (e: DragEvent<HTMLElement>) => {
      if (!dragHasFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      reset()
      if (disabled) return
      const files = Array.from(e.dataTransfer.files).filter((f) => f.size > 0)
      if (files.length > 0) onFiles(files)
    },
    [disabled, onFiles, reset]
  )

  return { active, bind: { onDragEnter, onDragLeave, onDragOver, onDrop } }
}
