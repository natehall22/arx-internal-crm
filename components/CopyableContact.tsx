'use client'

import { useEffect, useRef, useState } from 'react'

type Props = {
  /** Raw value shown and copied — phone number or email address. */
  value: string
  /** tel: or mailto: target for the tap-to-dial/tap-to-mail affordance. */
  href: string
  /** Leading emoji marker, matched to the surrounding card style. */
  icon: string
  /** What is being copied, used in the button's accessible name. */
  label: string
  className?: string
}

/**
 * Contact line that stays tap-to-dial on mobile but is still copyable on
 * desktop: dragging across anchor text starts a link drag instead of a
 * selection, so the value gets an explicit copy button and `select-all`.
 */
export default function CopyableContact({ value, href, icon, label, className }: Props) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      prompt(`Copy this ${label}:`, value)
    }
  }

  return (
    <div className={`min-h-[44px] flex items-center gap-2 ${className ?? ''}`}>
      <a href={href} className="min-h-[44px] flex items-center text-sm text-indigo-600 break-all">
        <span aria-hidden="true" className="mr-1">{icon}</span>
        <span className="select-all">{value}</span>
      </a>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        className="shrink-0 px-2 py-1 rounded border border-gray-300 text-xs font-medium text-[#2c2c2a] hover:bg-gray-100"
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  )
}
