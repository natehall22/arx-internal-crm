'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Nav from '@/components/Nav'

type EmailBlastType = 'sale' | 'job_payment' | 'morning_update'

type EmailBlastConfig = {
  enabled: boolean
  role_targets: string[]
  user_targets: string[]
}

type RoleOption = {
  role: string
  label: string
}

type Definition = {
  id: EmailBlastType
  title: string
  description: string
}

type AdminUser = {
  id: string
  full_name: string | null
  email: string | null
  role: string | null
  active: boolean
}

type EmailBlastSettings = Record<EmailBlastType, EmailBlastConfig>

export default function EmailBlastsPage() {
  const [definitions, setDefinitions] = useState<Definition[]>([])
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [settings, setSettings] = useState<EmailBlastSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const response = await fetch('/api/admin/email-blasts')
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load email blasts')
      }

      setDefinitions(data.definitions || [])
      setRoleOptions(data.roleOptions || [])
      setUsers(data.users || [])
      setSettings(data.settings || null)
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to load email blasts' })
    } finally {
      setLoading(false)
    }
  }

  const updateConfig = (blastType: EmailBlastType, updater: (current: EmailBlastConfig) => EmailBlastConfig) => {
    setSettings((current) => {
      if (!current) return current
      return {
        ...current,
        [blastType]: updater(current[blastType]),
      }
    })
  }

  const toggleRole = (blastType: EmailBlastType, role: string) => {
    updateConfig(blastType, (current) => {
      const exists = current.role_targets.includes(role)
      return {
        ...current,
        role_targets: exists
          ? current.role_targets.filter((item) => item !== role)
          : [...current.role_targets, role],
      }
    })
  }

  const toggleUser = (blastType: EmailBlastType, userId: string) => {
    updateConfig(blastType, (current) => {
      const exists = current.user_targets.includes(userId)
      return {
        ...current,
        user_targets: exists
          ? current.user_targets.filter((item) => item !== userId)
          : [...current.user_targets, userId],
      }
    })
  }

  const saveSettings = async () => {
    if (!settings) return
    setSaving(true)
    setMessage(null)

    try {
      const response = await fetch('/api/admin/email-blasts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save email blasts')
      }

      setSettings(data.settings || settings)
      setMessage({ type: 'success', text: 'Email blast settings saved' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to save email blasts' })
    } finally {
      setSaving(false)
    }
  }

  const sendMorningUpdateTest = async () => {
    setSendingTest(true)
    setMessage(null)

    try {
      const response = await fetch('/api/admin/email-blasts/morning-update/test', {
        method: 'POST',
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send test email')
      }

      setMessage({
        type: 'success',
        text: `Test morning update sent to ${data.to || 'your email'}`,
      })
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : 'Failed to send test email'
      setMessage({ type: 'error', text })
    } finally {
      setSendingTest(false)
    }
  }

  const recipientCounts = useMemo(() => {
    if (!settings) return {} as Record<EmailBlastType, number>

    return definitions.reduce((acc, definition) => {
      const config = settings[definition.id]
      const count = users.filter((user) => {
        if (!user.email) return false
        return config.user_targets.includes(user.id) || config.role_targets.includes(String(user.role || ''))
      }).length
      acc[definition.id] = count
      return acc
    }, {} as Record<EmailBlastType, number>)
  }, [definitions, settings, users])

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="mb-6">
          <Link href="/admin" className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-2">
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Admin
          </Link>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Email Blasts</h1>
              <p className="text-gray-600 mt-1">
                Control who gets sale, payment, and owner morning update emails. Scheduling and calendar emails are not changed here.
              </p>
            </div>
            <button
              onClick={saveSettings}
              disabled={loading || saving || !settings}
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </div>

        {message && (
          <div className={`mb-6 rounded-lg border px-4 py-3 ${
            message.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}>
            {message.text}
          </div>
        )}

        {loading || !settings ? (
          <div className="rounded-xl border bg-white p-8 text-center text-gray-500">Loading email blast settings...</div>
        ) : (
          <div className="space-y-6">
            {definitions.map((definition) => {
              const config = settings[definition.id]
              const selectedUsers = users.filter((user) => config.user_targets.includes(user.id))
              const roleOptionsForBlast =
                definition.id === 'morning_update'
                  ? roleOptions.filter((option) => option.role === 'owner' || option.role === 'admin')
                  : roleOptions
              const userOptionsForBlast =
                definition.id === 'morning_update'
                  ? users.filter((user) => user.role === 'owner' || user.role === 'admin')
                  : users

              return (
                <section key={definition.id} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="text-lg font-semibold text-gray-900">{definition.title}</h2>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          config.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {config.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-600">{definition.description}</p>
                      <p className="mt-2 text-sm text-gray-500">
                        Current recipients: {recipientCounts[definition.id] || 0}
                      </p>
                    </div>

                    <div className="flex flex-col items-stretch gap-2 sm:items-end">
                      <label className="inline-flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700">
                        <input
                          type="checkbox"
                          checked={config.enabled}
                          onChange={(e) => updateConfig(definition.id, (current) => ({ ...current, enabled: e.target.checked }))}
                          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        Enable this blast
                      </label>
                      {definition.id === 'morning_update' && (
                        <button
                          type="button"
                          onClick={sendMorningUpdateTest}
                          disabled={loading || sendingTest}
                          className="inline-flex items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                        >
                          {sendingTest ? 'Sending test…' : 'Send test to my email'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-6 grid gap-6 lg:grid-cols-2">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">Levels</h3>
                      <p className="mt-1 text-sm text-gray-500">Choose the roles that should always receive this email.</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {roleOptionsForBlast.map((option) => (
                          <label
                            key={`${definition.id}-${option.role}`}
                            className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700"
                          >
                            <input
                              type="checkbox"
                              checked={config.role_targets.includes(option.role)}
                              onChange={() => toggleRole(definition.id, option.role)}
                              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span>{option.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">Specific People</h3>
                      <p className="mt-1 text-sm text-gray-500">Add or remove named recipients without changing role-wide coverage.</p>
                      <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                        {userOptionsForBlast.map((user) => (
                          <label
                            key={`${definition.id}-${user.id}`}
                            className="flex items-start gap-3 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700"
                          >
                            <input
                              type="checkbox"
                              checked={config.user_targets.includes(user.id)}
                              onChange={() => toggleUser(definition.id, user.id)}
                              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span>
                              <span className="block font-medium text-gray-900">{user.full_name || user.email}</span>
                              <span className="block text-xs text-gray-500">
                                {user.email} {user.role ? `• ${roleOptions.find((option) => option.role === user.role)?.label || user.role}` : ''}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>

                  {selectedUsers.length > 0 && (
                    <div className="mt-5 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
                      Added directly: {selectedUsers.map((user) => user.full_name || user.email).join(', ')}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
