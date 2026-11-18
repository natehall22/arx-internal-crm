'use client'

import { useCallback, useEffect, useState } from 'react'
import { confirmDialog } from '@/components/ui/confirm-dialog'

type Connection = { provider: 'google' | 'microsoft'; expires_at: string; account_email: string | null } | null

/**
 * "Connect Outlook" (Microsoft 365 calendar). Hidden unless the server has Outlook configured. One calendar per user:
 * connecting Outlook replaces a connected Google Calendar (confirmed first).
 */
export default function OutlookConnectCard() {
  const [available, setAvailable] = useState(false)
  const [connection, setConnection] = useState<Connection>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings', { credentials: 'same-origin' })
      if (!res.ok) return
      const data = await res.json()
      setAvailable(Boolean(data.microsoftAvailable))
      setConnection(data.calendarConnection ?? null)
    } catch {
      /* card stays hidden */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!available) return null

  const connect = async () => {
    if (connection?.provider === 'google') {
      const ok = await confirmDialog({
        title: 'Connect Outlook? This disconnects your Google Calendar. Only one calendar can be connected at a time.',
        destructive: true,
      })
      if (!ok) return
    }
    window.location.href = '/api/auth/microsoft'
  }

  const disconnect = async () => {
    if (!(await confirmDialog({ title: 'Disconnect Outlook Calendar?', destructive: true }))) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/settings?provider=microsoft', { method: 'DELETE', credentials: 'same-origin' })
      if (!res.ok) throw new Error('failed')
      await load()
    } catch {
      setError('Could not disconnect. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const connected = connection?.provider === 'microsoft'
  return (
    <div className="p-4 bg-gray-50 rounded-lg mb-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-gray-900">Outlook Calendar (Microsoft 365)</p>
          <p className="text-sm text-gray-700">
            {connected ? `Connected${connection?.account_email ? ` as ${connection.account_email}` : ''}` : 'Not connected'}
          </p>
          {error && <p className="text-sm text-red-700">{error}</p>}
        </div>
        {connected ? (
          <button
            onClick={disconnect}
            disabled={busy}
            className="min-h-[44px] px-4 py-2 text-red-700 border border-red-200 rounded-lg hover:bg-red-50 text-sm font-medium"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={connect}
            className="min-h-[44px] px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
          >
            Connect Outlook
          </button>
        )}
      </div>
    </div>
  )
}
