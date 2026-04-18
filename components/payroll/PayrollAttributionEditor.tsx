'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type OrgUser = { id: string; full_name: string }

export type PayrollAttributionData = {
  opportunity_id: string
  setter_user_id: string | null
  closer_user_id: string | null
  setter_name: string | null
  closer_name: string | null
}

type Props = {
  opportunityId: string
  initial: PayrollAttributionData
  canEdit: boolean
  /** Sync parent state after save (e.g. job detail). If omitted, `router.refresh()` runs when possible. */
  onSaved?: (next: PayrollAttributionData) => void
}

export default function PayrollAttributionEditor({
  opportunityId,
  initial,
  canEdit,
  onSaved,
}: Props) {
  const router = useRouter()
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([])
  const [saving, setSaving] = useState(false)
  const [setterEditId, setSetterEditId] = useState('')
  const [closerEditId, setCloserEditId] = useState('')
  const [display, setDisplay] = useState({
    setter_name: initial.setter_name,
    closer_name: initial.closer_name,
    setter_user_id: initial.setter_user_id,
    closer_user_id: initial.closer_user_id,
  })

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/users')
        if (response.ok) {
          const data = await response.json()
          setOrgUsers(data.users || [])
        }
      } catch (e) {
        console.error('Error loading org users:', e)
      }
    }
    load()
  }, [])

  useEffect(() => {
    setSetterEditId(initial.setter_user_id || '')
    setCloserEditId(initial.closer_user_id || '')
    setDisplay({
      setter_name: initial.setter_name,
      closer_name: initial.closer_name,
      setter_user_id: initial.setter_user_id,
      closer_user_id: initial.closer_user_id,
    })
  }, [
    initial.opportunity_id,
    initial.setter_user_id,
    initial.closer_user_id,
    initial.setter_name,
    initial.closer_name,
  ])

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setter_user_id: setterEditId || null,
          owner_user_id: closerEditId || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert((j as { error?: string }).error || 'Could not save attribution')
        return
      }
      const setterName = setterEditId
        ? orgUsers.find((u) => u.id === setterEditId)?.full_name || null
        : null
      const closerName = closerEditId
        ? orgUsers.find((u) => u.id === closerEditId)?.full_name || null
        : null
      const next: PayrollAttributionData = {
        opportunity_id: opportunityId,
        setter_user_id: setterEditId || null,
        closer_user_id: closerEditId || null,
        setter_name: setterName,
        closer_name: closerName,
      }
      setDisplay({
        setter_name: setterName,
        closer_name: closerName,
        setter_user_id: next.setter_user_id,
        closer_user_id: next.closer_user_id,
      })
      onSaved?.(next)
      if (!onSaved) {
        router.refresh()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
      <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-1">Payroll attribution</h2>
      <p className="text-xs text-gray-500 mb-4">
        Setter and closer come from the linked opportunity and drive commission export. Closer uses the
        opportunity &quot;owner&quot; field in the database.
      </p>
      {canEdit ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Setter</label>
            <select
              value={setterEditId}
              onChange={(e) => setSetterEditId(e.target.value)}
              className="w-full max-w-md border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
            >
              <option value="">— None —</option>
              {orgUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name || u.id}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Closer</label>
            <select
              value={closerEditId}
              onChange={(e) => setCloserEditId(e.target.value)}
              className="w-full max-w-md border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900"
            >
              <option value="">— None —</option>
              {orgUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name || u.id}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="min-h-[44px] px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save attribution'}
          </button>
        </div>
      ) : (
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-gray-600">Setter</dt>
            <dd className="font-medium text-gray-900 text-right">{display.setter_name || '—'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-gray-600">Closer</dt>
            <dd className="font-medium text-gray-900 text-right">{display.closer_name || '—'}</dd>
          </div>
        </dl>
      )}
    </div>
  )
}
