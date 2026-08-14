'use client'

import { useState } from 'react'
import Link from 'next/link'
import Nav from '@/components/Nav'

export default function ResendMorningEmailsPage() {
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  // Set when the server reports today's emails already went out, which turns the second
  // click into a deliberate "yes, send a duplicate" rather than an accidental one.
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)

  const resend = async (force = false) => {
    setSending(true)
    setMessage(null)

    try {
      const response = await fetch('/api/admin/email-blasts/resend-today', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      const data = await response.json()

      if (response.status === 409 && data.alreadySentToday) {
        setDuplicateWarning(data.error || 'Today&apos;s emails already went out.')
        return
      }

      if (!response.ok) throw new Error(data.error || 'Failed to resend morning emails')

      const morningCount = data.morningUpdate?.sent || 0
      const tifCount = data.setterFieldUpdate?.sent || 0
      const warning = data.warning ? ` ${data.warning}` : ''
      setDuplicateWarning(null)
      setMessage({
        type: 'success',
        text: `Resend complete: ${morningCount} Morning Update email(s) and ${tifCount} Setter TIF email(s) sent.${warning}`,
      })
    } catch (error: unknown) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to resend morning emails',
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Link href="/admin/email-blasts" className="text-sm text-gray-600 hover:text-gray-900">
          ← Back to Email Blasts
        </Link>

        <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-gray-900">Resend Today&apos;s Morning Emails</h1>
          <p className="mt-2 text-gray-600">
            Sends the ARX Morning Update and Setter Time In Field reports now using the current configured recipients. This bypasses the normal 5:30 AM send window.
          </p>

          <div className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
            This is a live resend. Everyone currently configured for these reports may receive another copy.
          </div>

          {message && (
            <div className={`mt-5 rounded-lg border px-4 py-3 ${message.type === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {message.text}
            </div>
          )}

          {duplicateWarning && (
            <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-[#2c2c2a]">{duplicateWarning}</p>
              <p className="mt-1 text-sm text-[#2c2c2a]">
                Only send again if the first copy genuinely did not arrive — everyone configured
                for these reports will get a second copy.
              </p>
              <button
                type="button"
                onClick={() => resend(true)}
                disabled={sending}
                className="mt-3 inline-flex items-center justify-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {sending ? 'Sending…' : 'Send a second copy anyway'}
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => resend(false)}
            disabled={sending}
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {sending ? 'Resending…' : 'Resend both now'}
          </button>
        </div>
      </div>
    </div>
  )
}
