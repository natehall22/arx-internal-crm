'use client'

import { useState } from 'react'
import FeedbackModal from '@/components/FeedbackModal'

type Props = {
  userName?: string
  userEmail?: string
  /** settings-row = full list item; compact-link = subtle text above bottom nav */
  variant?: 'settings-row' | 'compact-link'
}

export default function CanvassReportIssue({
  userName = '',
  userEmail = '',
  variant = 'settings-row',
}: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {variant === 'compact-link' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pointer-events-auto rounded-full bg-white/95 px-4 py-2 text-xs font-medium text-[#2c2c2a] shadow-md border border-gray-200 backdrop-blur active:scale-[0.98]"
        >
          Report an issue
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full p-4 flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div>
              <p className="font-medium text-[#2c2c2a]">Report an Issue</p>
              <p className="text-xs text-gray-600">Sent to info@arxroofing.com</p>
            </div>
          </div>
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      <FeedbackModal
        isOpen={open}
        onClose={() => setOpen(false)}
        userName={userName}
        userEmail={userEmail}
      />
    </>
  )
}
