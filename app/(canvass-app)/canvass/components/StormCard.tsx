'use client'

import { useEffect, useState } from 'react'
import type { PinStormSummary } from '../lib/weather-overlay'

interface Props {
  summary: PinStormSummary
  /** When false, hide the kind === 'none' empty-state card (LeadModal only shows it with weather on). */
  showNoneCase?: boolean
}

export default function StormCard({ summary, showNoneCase = true }: Props) {
  const [stormExpanded, setStormExpanded] = useState(false)

  useEffect(() => {
    setStormExpanded(false)
  }, [summary.headline, summary.kind])

  if (summary.kind !== 'none') {
    return (
      <div className="rounded-xl border border-violet-200 bg-violet-50 overflow-hidden px-3 py-3 space-y-2">
        <p className="text-base font-semibold text-[#2c2c2a] leading-snug">
          {summary.headline.replace(' ▸', '')}
        </p>
        {summary.talkTrack && (
          <p className="text-base text-[#2c2c2a] leading-snug">“{summary.talkTrack}”</p>
        )}
        <button
          type="button"
          onClick={() => setStormExpanded((value) => !value)}
          className="text-xs font-medium text-violet-700 underline"
        >
          {stormExpanded ? 'Hide details' : 'Details'}
        </button>
        {stormExpanded && (
          <div className="space-y-1 border-t border-violet-200 pt-2">
            <p className="text-sm font-semibold text-[#2c2c2a]">{summary.expandedHeadline}</p>
            {summary.dateLabel && summary.kind === 'report' && (
              <p className="text-xs text-[#2c2c2a]">Event date: {summary.dateLabel}</p>
            )}
            {summary.kind === 'warning' && summary.expiresLabel && (
              <p className="text-xs text-[#2c2c2a]">
                Active warning until {summary.expiresLabel}
              </p>
            )}
            <p className="text-[11px] text-[#2c2c2a]">
              This area may have been impacted — free inspection
            </p>
          </div>
        )}
      </div>
    )
  }

  if (!showNoneCase) return null

  return (
    <div className="px-3 py-3 rounded-xl border border-gray-200 bg-gray-50 space-y-2">
      {summary.talkTrack && (
        <p className="text-base text-[#2c2c2a] leading-snug">“{summary.talkTrack}”</p>
      )}
      <p className="text-xs text-[#2c2c2a]">{summary.emptyMessage}</p>
    </div>
  )
}
