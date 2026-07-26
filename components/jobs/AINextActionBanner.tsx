'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAISettings } from '@/hooks/useAISettings'

type AINextActionJob = {
  status: string
  deposit: number | null
  deposit_required_percent: number
  materials_status: string
  scheduled_date: string | null
  assigned_sub_id: string | null
  assigned_crew_id: string | null
  final_front: boolean
  final_back: boolean
  final_left: boolean
  final_right: boolean
  final_slope_1: boolean
  final_slope_2: boolean
  flashing_detail: boolean
  pipe_boots: boolean
  labor_cost: number | null
  material_cost: number | null
  sale_amount: number
}

interface AINextActionBannerProps {
  job: AINextActionJob
}

type AIResponse = {
  action: string
  priority: 'urgent' | 'normal' | 'low'
  reason: string
}

const fallbackResponse: AIResponse = {
  action: '',
  priority: 'normal',
  reason: '',
}

function parseAIResult(result: unknown): AIResponse {
  if (!result) return fallbackResponse

  const parsed =
    typeof result === 'string'
      ? (() => {
          try {
            return JSON.parse(result)
          } catch {
            return null
          }
        })()
      : result

  if (!parsed || typeof parsed !== 'object') {
    return fallbackResponse
  }

  const maybeAction = (parsed as any).action
  const maybeReason = (parsed as any).reason
  const maybePriority = (parsed as any).priority

  return {
    action: typeof maybeAction === 'string' && maybeAction.trim() ? maybeAction : fallbackResponse.action,
    reason: typeof maybeReason === 'string' && maybeReason.trim() ? maybeReason : fallbackResponse.reason,
    priority:
      maybePriority === 'urgent' || maybePriority === 'normal' || maybePriority === 'low'
        ? maybePriority
        : fallbackResponse.priority,
  }
}

/** Stable fingerprint of the fields that drive the suggestion — parents pass a fresh object each render. */
function jobSuggestionKey(job: AINextActionJob): string {
  return [
    job.status,
    (job.deposit ?? 0) > 0 ? '1' : '0',
    job.deposit_required_percent,
    job.materials_status,
    job.scheduled_date ?? '',
    job.assigned_sub_id || job.assigned_crew_id ? '1' : '0',
    [
      job.final_front,
      job.final_back,
      job.final_left,
      job.final_right,
      job.final_slope_1,
      job.final_slope_2,
      job.flashing_detail,
      job.pipe_boots,
    ]
      .map((v) => (v ? '1' : '0'))
      .join(''),
    (job.labor_cost ?? 0) > 0 || (job.material_cost ?? 0) > 0 ? '1' : '0',
    job.sale_amount,
  ].join('|')
}

function buildJobNextActionContext(job: AINextActionJob) {
  return {
    status: job.status,
    depositRecorded: (job.deposit ?? 0) > 0,
    depositRequiredPercent: job.deposit_required_percent,
    materialsStatus: job.materials_status,
    scheduledDate: job.scheduled_date,
    crewAssigned: !!(job.assigned_sub_id || job.assigned_crew_id),
    photosComplete: {
      front: job.final_front,
      back: job.final_back,
      leftSide: job.final_left,
      rightSide: job.final_right,
      slope1: job.final_slope_1,
      slope2: job.final_slope_2,
      flashing: job.flashing_detail,
      pipeBoots: job.pipe_boots,
    },
    costsEntered: (job.labor_cost ?? 0) > 0 || (job.material_cost ?? 0) > 0,
    saleAmount: job.sale_amount,
  }
}

export default function AINextActionBanner({ job }: AINextActionBannerProps) {
  const { aiEnabled, aiSuggestionsEnabled } = useAISettings()
  const [suggestion, setSuggestion] = useState<AIResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [hidden, setHidden] = useState(false)
  const suggestionKey = jobSuggestionKey(job)

  const loadSuggestion = useCallback(
    async (targetJob: AINextActionJob, signal?: AbortSignal) => {
      setLoading(true)
      setHidden(false)
      try {
        const aiResponse = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'job_next_action',
            context: buildJobNextActionContext(targetJob),
          }),
          signal,
        })

        if (signal?.aborted) return

        if (!aiResponse.ok) {
          setHidden(true)
          return
        }

        const data = await aiResponse.json()
        if (signal?.aborted) return

        const parsed = parseAIResult(data?.result)
        if (!parsed.action || !parsed.reason) {
          setHidden(true)
          return
        }
        setSuggestion(parsed)
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          return
        }
        setHidden(true)
      } finally {
        if (!signal?.aborted) {
          setLoading(false)
        }
      }
    },
    []
  )

  useEffect(() => {
    if (!aiEnabled || !aiSuggestionsEnabled) {
      setSuggestion(null)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    void loadSuggestion(job, controller.signal)

    return () => {
      controller.abort()
    }
    // suggestionKey fingerprints the job fields that affect the prompt; do not depend on `job` identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: parent passes a new object every render
  }, [aiEnabled, aiSuggestionsEnabled, suggestionKey, loadSuggestion])

  const handleRefresh = () => {
    void loadSuggestion(job)
  }

  if (!aiEnabled || !aiSuggestionsEnabled || hidden) return null

  const borderClass =
    suggestion?.priority === 'urgent'
      ? 'border-l-red-500'
      : suggestion?.priority === 'low'
        ? 'border-l-gray-400'
        : 'border-l-yellow-500'

  return (
    <div className={`mb-6 rounded-lg border border-gray-200 border-l-4 bg-white p-4 ${borderClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-[#2c2c2a]/70">✨ AI Suggestion</div>
          {loading ? (
            <div className="mt-2 h-5 w-3/4 animate-pulse rounded bg-gray-200" />
          ) : (
            <>
              <div className="mt-1 text-base font-semibold text-[#2c2c2a]">{suggestion?.action || ''}</div>
              <div className="mt-1 text-sm text-[#2c2c2a]/80">{suggestion?.reason || ''}</div>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={loading}
          className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-[#2c2c2a] hover:bg-gray-50 disabled:opacity-50"
        >
          ↺ Refresh
        </button>
      </div>
    </div>
  )
}
