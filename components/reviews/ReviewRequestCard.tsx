'use client'

import { useCallback, useEffect, useState } from 'react'

type PrepareResponse = {
  message: string
  phone: string | null
  customerName: string | null
  link: string
  sentAt: string | null
  sentByName: string | null
  error?: string
}

type Props = {
  jobId: string
  variant?: 'full' | 'compact'
  /** Called after the request is marked sent (e.g. so an ops list can drop the row). */
  onSent?: () => void
}

function cleanPhone(phone: string): string {
  const trimmed = phone.trim()
  const plus = trimmed.startsWith('+') ? '+' : ''
  return plus + trimmed.replace(/[^\d]/g, '')
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

function formatSentDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return ''
  }
}

export default function ReviewRequestCard({ jobId, variant = 'full', onSent }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<PrepareResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sentAt, setSentAt] = useState<string | null>(null)
  const [sentByName, setSentByName] = useState<string | null>(null)
  const [showActions, setShowActions] = useState(false)
  const [showPreview, setShowPreview] = useState(variant === 'full')
  const [copied, setCopied] = useState<'message' | 'number' | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}/review-request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'prepare' }),
        })
        const json: PrepareResponse = await res.json()
        if (!active) return
        if (!res.ok) {
          setError(json?.error || 'Could not load review request')
        } else {
          setData(json)
          setSentAt(json.sentAt)
          setSentByName(json.sentByName)
        }
      } catch {
        if (active) setError('Could not load review request')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [jobId])

  const markSent = useCallback(async () => {
    // Optimistic: the rep is sending now.
    setSentAt((prev) => prev ?? new Date().toISOString())
    try {
      const res = await fetch(`/api/jobs/${jobId}/review-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sent' }),
        keepalive: true,
      })
      const json: PrepareResponse = await res.json()
      if (res.ok) {
        setSentAt(json.sentAt)
        setSentByName(json.sentByName)
      }
    } catch {
      // keep optimistic state
    }
    onSent?.()
  }, [jobId, onSent])

  const handleCopy = useCallback(
    async (what: 'message' | 'number') => {
      if (!data) return
      const text = what === 'message' ? data.message : cleanPhone(data.phone || '')
      const ok = await copyText(text)
      if (ok) {
        setCopied(what)
        setTimeout(() => setCopied(null), 2000)
        if (what === 'message') void markSent()
      }
    },
    [data, markSent]
  )

  const wrap = variant === 'compact' ? '' : 'rounded-lg border border-gray-200 bg-white p-4'

  if (loading) {
    return (
      <div className={wrap}>
        <p className="text-sm text-gray-500">Loading review request…</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className={wrap}>
        <p className="text-sm text-red-600">{error || 'Could not load review request.'}</p>
      </div>
    )
  }

  const isSent = !!sentAt
  const smsHref = data.phone
    ? `sms:${cleanPhone(data.phone)}?&body=${encodeURIComponent(data.message)}`
    : null

  return (
    <div className={wrap}>
      {variant === 'full' && (
        <div className="mb-3">
          <h3 className="text-base font-semibold text-gray-900">Ask for a Google review</h3>
          <p className="mt-0.5 text-sm text-gray-600">
            {data.customerName ? `Send ${data.customerName} a quick review request.` : 'Send the customer a quick review request.'}
          </p>
        </div>
      )}

      {isSent && !showActions ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 font-medium text-green-800">
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.3 3.3 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" />
            </svg>
            Review requested{sentAt ? ` ${formatSentDate(sentAt)}` : ''}
          </span>
          {sentByName && <span className="text-gray-500">by {sentByName}</span>}
          <button
            type="button"
            onClick={() => setShowActions(true)}
            className="text-gray-500 underline underline-offset-2 hover:text-gray-700"
          >
            Send again
          </button>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {smsHref ? (
              <a
                href={smsHref}
                onClick={() => void markSent()}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#2c2c2a] px-3.5 py-2 text-sm font-semibold text-white hover:bg-black"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H7l-4 3v-3H4a2 2 0 01-2-2V5z" />
                </svg>
                Text review request
              </a>
            ) : (
              <span className="text-sm text-amber-700">No phone number on file — use Copy message.</span>
            )}

            <button
              type="button"
              onClick={() => handleCopy('message')}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              {copied === 'message' ? 'Copied!' : 'Copy message'}
            </button>

            {data.phone && (
              <button
                type="button"
                onClick={() => handleCopy('number')}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
              >
                {copied === 'number' ? 'Copied!' : 'Copy number'}
              </button>
            )}
          </div>

          <p className="mt-2 text-xs text-gray-500">
            Tap <span className="font-medium text-gray-700">Text review request</span> to send from your phone, or use{' '}
            <span className="font-medium text-gray-700">Copy</span> to send from Google Voice.
          </p>

          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowPreview((s) => !s)}
              className="text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700"
            >
              {showPreview ? 'Hide message' : 'Preview message'}
            </button>
            {showPreview && (
              <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-gray-50 p-2.5 text-sm text-gray-800">
                {data.message}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
