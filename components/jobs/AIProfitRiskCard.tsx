'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAISettings } from '@/hooks/useAISettings'

interface AIProfitRiskCardProps {
  job: {
    sale_amount: number
    labor_cost: number | null
    material_cost: number | null
    job_type: string
    scope_of_work: string
  }
}

type ProfitRiskResponse = {
  riskLevel: 'high' | 'medium' | 'low'
  estimatedMarginPercent: number
  warning: string | null
  suggestion: string
}

function parseResponse(result: unknown): ProfitRiskResponse | null {
  if (!result) return null

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

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const o = parsed as Record<string, unknown>
  const riskLevel = o.riskLevel
  const estimatedMarginPercent = Number(o.estimatedMarginPercent)
  const warning = o.warning
  const suggestion = o.suggestion

  if (riskLevel !== 'high' && riskLevel !== 'medium' && riskLevel !== 'low') return null
  if (!Number.isFinite(estimatedMarginPercent)) return null
  if (warning !== null && typeof warning !== 'string') return null
  if (typeof suggestion !== 'string') return null

  return {
    riskLevel,
    estimatedMarginPercent,
    warning,
    suggestion,
  }
}

export default function AIProfitRiskCard({ job }: AIProfitRiskCardProps) {
  const { aiEnabled } = useAISettings()
  const [loading, setLoading] = useState(true)
  const [hidden, setHidden] = useState(false)
  const [analysis, setAnalysis] = useState<ProfitRiskResponse | null>(null)

  const laborCost = job.labor_cost ?? 0
  const materialCost = job.material_cost ?? 0
  const totalCosts = laborCost + materialCost

  const shouldRender = useMemo(() => {
    if (!aiEnabled) return false
    if (job.sale_amount <= 0) return false
    if (laborCost <= 0 && materialCost <= 0) return false
    return true
  }, [aiEnabled, job.sale_amount, laborCost, materialCost])

  useEffect(() => {
    if (!shouldRender) {
      setLoading(false)
      return
    }

    const load = async () => {
      setLoading(true)
      setHidden(false)
      try {
        const response = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'job_profit_risk',
            context: {
              saleAmount: job.sale_amount,
              laborCost,
              materialCost,
              totalCosts,
              jobType: job.job_type,
              estimatedMarginIfNoMoreCosts: (((job.sale_amount - totalCosts) / job.sale_amount) * 100).toFixed(1) + '%',
            },
          }),
        })

        if (!response.ok) {
          setHidden(true)
          return
        }

        const data = await response.json()
        const parsed = parseResponse(data?.result)
        if (!parsed) {
          setHidden(true)
          return
        }
        setAnalysis(parsed)
      } catch {
        setHidden(true)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [shouldRender, job.sale_amount, job.job_type, laborCost, materialCost, totalCosts])

  if (!shouldRender || hidden) return null

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
        <div className="h-5 w-40 animate-pulse rounded bg-gray-200" />
        <div className="mt-4 h-4 w-24 animate-pulse rounded bg-gray-200" />
        <div className="mt-3 h-4 w-full animate-pulse rounded bg-gray-200" />
        <div className="mt-2 h-4 w-4/5 animate-pulse rounded bg-gray-200" />
      </div>
    )
  }

  if (!analysis) return null

  const riskBadgeClass =
    analysis.riskLevel === 'high'
      ? 'bg-red-100 text-red-700'
      : analysis.riskLevel === 'medium'
        ? 'bg-yellow-100 text-yellow-700'
        : 'bg-green-100 text-green-700'

  const riskLabel =
    analysis.riskLevel === 'high'
      ? '🔴 High Risk'
      : analysis.riskLevel === 'medium'
        ? '🟡 Medium'
        : '🟢 On Track'

  return (
    <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base sm:text-lg font-semibold text-gray-900">✨ AI Profit Analysis</h2>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${riskBadgeClass}`}>{riskLabel}</span>
      </div>

      <div className="mt-4 text-sm text-gray-900">
        <span className="font-medium">Est. Margin:</span> {analysis.estimatedMarginPercent.toFixed(1)}%
      </div>

      {analysis.warning && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {analysis.warning}
        </div>
      )}

      <p className="mt-3 text-sm text-gray-500">{analysis.suggestion}</p>
      <p className="mt-4 text-xs text-gray-400">Based on costs entered so far</p>
    </div>
  )
}
