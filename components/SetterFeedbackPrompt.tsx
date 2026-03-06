'use client'

import { useState } from 'react'
import { useInspectionResults } from '@/hooks/useRealtimeUpdates'

const outcomeStyles: Record<string, { bg: string; text: string; icon: string }> = {
  sale: { bg: 'bg-green-100', text: 'text-green-800', icon: '🎉' },
  moving_to_close: { bg: 'bg-emerald-100', text: 'text-emerald-800', icon: '→' },
  insurance_follow_up: { bg: 'bg-purple-100', text: 'text-purple-800', icon: '📋' },
  said_no: { bg: 'bg-red-100', text: 'text-red-800', icon: '✗' },
  not_home: { bg: 'bg-amber-100', text: 'text-amber-800', icon: '?' },
  no_problems_found: { bg: 'bg-gray-100', text: 'text-gray-800', icon: '○' },
  needs_repair: { bg: 'bg-orange-100', text: 'text-orange-800', icon: '🔧' },
  rescheduled: { bg: 'bg-blue-100', text: 'text-blue-800', icon: '↻' },
}

const outcomeLabels: Record<string, string> = {
  sale: 'Sale!',
  moving_to_close: 'Moving to Close',
  insurance_follow_up: 'Insurance Follow Up',
  said_no: 'Said No',
  not_home: 'Not Home',
  no_problems_found: 'No Problems Found',
  needs_repair: 'Needs Repair',
  rescheduled: 'Rescheduled',
}

export default function SetterFeedbackPrompt() {
  const { results, refresh } = useInspectionResults()
  const [acknowledging, setAcknowledging] = useState<string | null>(null)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  const acknowledgeResult = async (resultId: string) => {
    setAcknowledging(resultId)
    try {
      await fetch('/api/setter/acknowledge-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_id: resultId }),
      })
      setDismissedIds(prev => new Set(Array.from(prev).concat(resultId)))
      refresh()
    } catch (error) {
      console.error('Error acknowledging result:', error)
    } finally {
      setAcknowledging(null)
    }
  }

  const visibleResults = results.filter(r => !dismissedIds.has(r.id))

  if (visibleResults.length === 0) return null

  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-md w-full flex flex-col max-h-[80vh]">
      {visibleResults.length > 1 && (
        <div className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-t-xl flex items-center justify-between">
          <span>{visibleResults.length} inspection results to review</span>
          <span className="text-blue-200 text-xs">Scroll to see all</span>
        </div>
      )}
      
      <div className={`overflow-y-auto space-y-3 p-1 ${visibleResults.length > 1 ? 'pt-3' : ''}`} style={{ maxHeight: 'calc(80vh - 60px)' }}>
        {visibleResults.map((result) => {
          const outcome = result.data?.outcome || 'unknown'
          const style = outcomeStyles[outcome] || { bg: 'bg-gray-100', text: 'text-gray-800', icon: '•' }
          const label = outcomeLabels[outcome] || outcome
          const resultDate = new Date(result.created_at)
          
          return (
            <div
              key={result.id}
              className="bg-white rounded-xl shadow-lg border border-blue-200 overflow-hidden animate-slide-up"
            >
              <div className={`${style.bg} px-4 py-3 border-b border-blue-100`}>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{style.icon}</span>
                  <div>
                    <h4 className={`font-bold ${style.text}`}>{label}</h4>
                    <p className="text-xs text-gray-600">
                      {resultDate.toLocaleDateString('en-US', { 
                        weekday: 'short',
                        month: 'short', 
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                        timeZone: 'America/New_York'
                      })}
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="p-4 space-y-3">
                <div className="text-sm text-gray-700 whitespace-pre-line">
                  {result.body}
                </div>
                
                {result.data?.setter_feedback && (
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                    <p className="text-xs font-medium text-blue-700 uppercase tracking-wide mb-1">
                      Message from Closer
                    </p>
                    <p className="text-sm text-blue-900 italic">
                      "{result.data.setter_feedback}"
                    </p>
                  </div>
                )}
                
                {result.data?.notes && result.data.notes !== result.data.setter_feedback && (
                  <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                    <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-1">
                      Additional Notes
                    </p>
                    <p className="text-sm text-gray-800">
                      {result.data.notes}
                    </p>
                  </div>
                )}
                
                <button
                  onClick={() => acknowledgeResult(result.id)}
                  disabled={acknowledging === result.id}
                  className="w-full py-3 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {acknowledging === result.id ? 'Acknowledging...' : 'Accept'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
      
      <style jsx>{`
        @keyframes slide-up {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </div>
  )
}
