'use client'

import type { DragEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

/** True when the drag carries files from the desktop (not text or a link dragged inside the page). */
export function dragHasFiles(e: { dataTransfer: DataTransfer | null }): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')
}

/**
 * The files in a drop, minus folders (webkitGetAsEntry().isDirectory) and empty entries. A dropped folder shows up as a
 * 0-byte (or 4096-byte on some systems) "file" that fails to upload, so it is skipped rather than reported as an error.
 */
export function droppedFiles(dt: DataTransfer): File[] {
  const items = Array.from(dt.items ?? [])
  if (items.length > 0) {
    const out: File[] = []
    for (const item of items) {
      if (item.kind !== 'file') continue
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
      if (entry?.isDirectory) continue
      const f = item.getAsFile()
      if (f && f.size > 0) out.push(f)
    }
    return out
  }
  return Array.from(dt.files ?? []).filter((f) => f.size > 0)
}

/**
 * THE drag-and-drop behaviour for every "add files" area (Nathan's rule: any upload option takes drops as well as the picker).
 * Spread `bind` on the drop area; `active` is true while files hover over it. Nested children don't flicker the highlight
 * (enter/leave are depth-counted). Folders and empty entries are skipped. While mounted, a file dropped anywhere else on the
 * page is swallowed, so a near miss never makes the browser open the file and leave the page mid-upload.
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
      if (!dragHasFiles(e)) return
      // Always take the dragover (even while busy): otherwise the browser's default drop opens the file and leaves the page.
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
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
      const files = droppedFiles(e.dataTransfer)
      if (files.length > 0) onFiles(files)
    },
    [disabled, onFiles, reset]
  )

  useEffect(() => {
    const swallow = (e: globalThis.DragEvent) => {
      // A real drop zone already took it (preventDefault): leave its dropEffect alone, or 'none' here would cancel its drop.
      if (!dragHasFiles(e) || e.defaultPrevented) return
      e.preventDefault()
      if (e.type === 'dragover' && e.dataTransfer) e.dataTransfer.dropEffect = 'none'
    }
    window.addEventListener('dragover', swallow)
    window.addEventListener('drop', swallow)
    return () => {
      window.removeEventListener('dragover', swallow)
      window.removeEventListener('drop', swallow)
    }
  }, [])

  return { active, bind: { onDragEnter, onDragLeave, onDragOver, onDrop } }
}
