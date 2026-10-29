'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * The "⋯" button + a small panel of actions. 44px target, closes on outside tap / Escape, panel never wider than the
 * screen (right-aligned, so it opens inward from the page edge). Children are the actions (or a function given `close`, for an action that should dismiss the menu); give each `min-h-[44px]`.
 * Pass `className="sm:hidden"` etc. to show it only where the inline buttons no longer fit.
 */
export function OverflowMenu({ label = 'More actions', className = '', children }: { label?: string; className?: string; children: ReactNode | ((close: () => void) => ReactNode) }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className={`relative inline-block ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-gray-300 bg-white text-xl font-bold leading-none text-[#2c2c2a] hover:bg-gray-50"
      >
        <span aria-hidden>⋯</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  )
}

/** A full-width row for an OverflowMenu. */
export const MENU_ITEM = 'flex min-h-[44px] w-full items-center rounded-md px-3 py-2 text-left text-sm font-medium text-[#2c2c2a] hover:bg-gray-100'
