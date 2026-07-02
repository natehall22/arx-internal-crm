'use client'

import { useState } from 'react'

/** Copies the public /r/{token} share URL for a generated inspection report. */
export default function CopyShareLinkButton({ shareToken }: { shareToken: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        const url = `${window.location.origin}/r/${shareToken}`
        try {
          await navigator.clipboard.writeText(url)
          setCopied(true)
          setTimeout(() => setCopied(false), 2500)
        } catch {
          prompt('Copy this link:', url)
        }
      }}
      className="px-4 py-2 border border-gray-300 text-gray-800 text-sm font-semibold rounded-lg hover:bg-gray-50"
    >
      {copied ? 'Copied ✓' : 'Copy share link'}
    </button>
  )
}
