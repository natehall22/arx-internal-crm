'use client'

import type { PinStormSummary } from '../lib/weather-overlay'
import StormCard from './StormCard'

interface Props {
  summary: PinStormSummary
  onDropPin: () => void
  onClose: () => void
}

export default function StormPeekSheet({ summary, onDropPin, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close storm preview"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-lg rounded-t-2xl bg-white shadow-xl animate-slide-up">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-lg font-semibold text-[#2c2c2a]">Storm at this spot</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 p-2 text-gray-500 hover:text-gray-700"
            aria-label="Close"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="space-y-4 p-4">
          <StormCard summary={summary} showNoneCase />
          <button
            type="button"
            onClick={onDropPin}
            className="w-full rounded-xl bg-indigo-600 py-3 text-base font-semibold text-white shadow-sm active:scale-[0.99]"
          >
            Drop pin / Knock
          </button>
        </div>
      </div>
    </div>
  )
}
