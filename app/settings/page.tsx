'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Nav from '@/components/Nav'

interface UserSettings {
  notifications_enabled: boolean
  email_notifications: boolean
  push_notifications: boolean
  notification_types: {
    inspection_outcome: boolean
    appointment_reminder: boolean
    commission_update: boolean
    team_updates: boolean
  }
  google_calendar_connected: boolean
  default_appointment_duration: number
  appointment_buffer_minutes: number
  working_hours_start: string
  working_hours_end: string
  working_days: number[]
  ai_enabled: boolean
  ai_suggestions_enabled: boolean
  theme: string
}

interface UserProfile {
  role: string
  full_name: string
}

const defaultSettings: UserSettings = {
  notifications_enabled: true,
  email_notifications: true,
  push_notifications: true,
  notification_types: {
    inspection_outcome: true,
    appointment_reminder: true,
    commission_update: true,
    team_updates: true,
  },
  google_calendar_connected: false,
  default_appointment_duration: 60,
  appointment_buffer_minutes: 30,
  working_hours_start: '08:00',
  working_hours_end: '20:00',
  working_days: [1, 2, 3, 4, 5],
  ai_enabled: false,
  ai_suggestions_enabled: true,
  theme: 'light',
}

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function SettingsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<UserSettings>(defaultSettings)
  const [aiEnabled, setAiEnabled] = useState(defaultSettings.ai_enabled)
  const [aiSuggestionsEnabled, setAiSuggestionsEnabled] = useState(defaultSettings.ai_suggestions_enabled)
  const [googleToken, setGoogleToken] = useState<any>(null)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [activeTab, setActiveTab] = useState<'notifications' | 'calendar' | 'ai' | 'reports' | 'display'>('notifications')
  const [calendarMessage, setCalendarMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    loadSettings()

    const tab = searchParams.get('tab')
    if (tab === 'notifications' || tab === 'calendar' || tab === 'ai' || tab === 'reports' || tab === 'display') {
      setActiveTab(tab)
    }

    // Check for OAuth callback messages
    const success = searchParams.get('success')
    const error = searchParams.get('error')
    
    if (success === 'calendar_connected') {
      setCalendarMessage({ type: 'success', text: 'Google Calendar connected successfully!' })
      setActiveTab('calendar')
      // Clear URL params
      router.replace('/settings')
    } else if (error) {
      const errorMessages: Record<string, string> = {
        oauth_denied: 'Google Calendar authorization was denied.',
        missing_params: 'Missing OAuth parameters. Please try again.',
        no_profile: 'User profile not found.',
        token_storage: 'Failed to store calendar tokens.',
        callback_failed: 'Calendar connection failed. Please try again.',
      }
      setCalendarMessage({ type: 'error', text: errorMessages[error] || 'An error occurred.' })
      setActiveTab('calendar')
      router.replace('/settings')
    }
  }, [searchParams])

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/settings')
      
      if (response.status === 401) {
        router.push('/login')
        return
      }
      
      if (!response.ok) {
        console.error('Failed to load settings')
        setLoading(false)
        return
      }
      
      const data = await response.json()
      
      if (data.profile) {
        setUserProfile(data.profile)
      }

      if (data.userSettings) {
        setSettings({
          notifications_enabled: data.userSettings.notifications_enabled,
          email_notifications: data.userSettings.email_notifications,
          push_notifications: data.userSettings.push_notifications,
          notification_types: data.userSettings.notification_types || defaultSettings.notification_types,
          google_calendar_connected: data.userSettings.google_calendar_connected,
          default_appointment_duration: data.userSettings.default_appointment_duration,
          appointment_buffer_minutes: data.userSettings.appointment_buffer_minutes,
          working_hours_start: data.userSettings.working_hours_start || '08:00',
          working_hours_end: data.userSettings.working_hours_end || '20:00',
          working_days: data.userSettings.working_days || [1, 2, 3, 4, 5],
          ai_enabled: data.userSettings.ai_enabled ?? defaultSettings.ai_enabled,
          ai_suggestions_enabled: data.userSettings.ai_suggestions_enabled ?? defaultSettings.ai_suggestions_enabled,
          theme: data.userSettings.theme || 'light',
        })
        setAiEnabled(data.userSettings.ai_enabled ?? defaultSettings.ai_enabled)
        setAiSuggestionsEnabled(data.userSettings.ai_suggestions_enabled ?? defaultSettings.ai_suggestions_enabled)
      }

      if (data.googleToken) {
        setGoogleToken(data.googleToken)
        setSettings(prev => ({ ...prev, google_calendar_connected: true }))
      }

      setLoading(false)
    } catch (error) {
      console.error('Error loading settings:', error)
      setLoading(false)
    }
  }

  const saveSettings = async () => {
    setSaving(true)
    
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...settings,
          ai_enabled: aiEnabled,
          ai_suggestions_enabled: aiSuggestionsEnabled,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        alert(data.error || 'Failed to save settings')
      } else {
        alert('Settings saved!')
      }
    } catch (error) {
      console.error('Failed to save settings:', error)
      alert('Failed to save settings')
    }
    
    setSaving(false)
  }

  const connectGoogleCalendar = () => {
    window.location.href = '/api/auth/google'
  }

  const disconnectGoogleCalendar = async () => {
    if (!confirm('Disconnect Google Calendar?')) return

    try {
      const response = await fetch('/api/settings', {
        method: 'DELETE',
        credentials: 'same-origin',
      })

      const data = await response.json().catch(() => ({}))

      if (response.ok) {
        setGoogleToken(null)
        setSettings((prev) => ({ ...prev, google_calendar_connected: false }))
        setCalendarMessage({ type: 'success', text: 'Google Calendar disconnected.' })
      } else {
        alert(
          typeof data.error === 'string'
            ? data.error
            : 'Failed to disconnect Google Calendar. Try again or sign out and back in.'
        )
      }
    } catch (error) {
      console.error('Error disconnecting:', error)
      alert('Failed to disconnect Google Calendar')
    }
  }

  const toggleWorkingDay = (day: number) => {
    setSettings(prev => ({
      ...prev,
      working_days: prev.working_days.includes(day)
        ? prev.working_days.filter(d => d !== day)
        : [...prev.working_days, day].sort()
    }))
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
            <p className="text-gray-500">Manage your preferences and integrations</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b overflow-x-auto">
          {[
            { id: 'notifications', label: 'Notifications', icon: '🔔' },
            { id: 'calendar', label: 'Calendar', icon: '📅' },
            { id: 'ai', label: 'AI Assistant', icon: '🤖' },
            { id: 'reports', label: 'My Reports', icon: '📊' },
            { id: 'display', label: 'Display', icon: '🎨' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-3 font-medium text-sm border-b-2 -mb-px whitespace-nowrap flex items-center gap-2 ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Notifications Tab */}
        {activeTab === 'notifications' && (
          <div className="bg-white rounded-xl shadow-sm border p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Notification Preferences</h2>
              
              <div className="space-y-4">
                <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">Enable Notifications</p>
                    <p className="text-sm text-gray-500">Receive notifications about your activities</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.notifications_enabled}
                    onChange={(e) => setSettings(prev => ({ ...prev, notifications_enabled: e.target.checked }))}
                    className="w-5 h-5 rounded border-gray-300 text-indigo-600"
                  />
                </label>

                {settings.notifications_enabled && (
                  <>
                    <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">Email Notifications</p>
                        <p className="text-sm text-gray-500">Receive notifications via email</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.email_notifications}
                        onChange={(e) => setSettings(prev => ({ ...prev, email_notifications: e.target.checked }))}
                        className="w-5 h-5 rounded border-gray-300 text-indigo-600"
                      />
                    </label>

                    <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">Push Notifications</p>
                        <p className="text-sm text-gray-500">Receive push notifications in browser/app</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.push_notifications}
                        onChange={(e) => setSettings(prev => ({ ...prev, push_notifications: e.target.checked }))}
                        className="w-5 h-5 rounded border-gray-300 text-indigo-600"
                      />
                    </label>

                    <div className="border-t pt-4 mt-4">
                      <h3 className="font-medium text-gray-900 mb-3">Notification Types</h3>
                      <div className="space-y-2">
                        {[
                          { key: 'inspection_outcome', label: 'Inspection Outcomes', desc: 'When your appointments are completed' },
                          { key: 'appointment_reminder', label: 'Appointment Reminders', desc: 'Before scheduled appointments' },
                          { key: 'commission_update', label: 'Commission Updates', desc: 'When commissions are calculated or paid' },
                          { key: 'team_updates', label: 'Team Updates', desc: 'News and updates from your team' },
                        ].map((type) => (
                          <label key={type.key} className="flex items-center justify-between p-3 border rounded-lg">
                            <div>
                              <p className="font-medium text-gray-900 text-sm">{type.label}</p>
                              <p className="text-xs text-gray-500">{type.desc}</p>
                            </div>
                            <input
                              type="checkbox"
                              checked={settings.notification_types[type.key as keyof typeof settings.notification_types]}
                              onChange={(e) => setSettings(prev => ({
                                ...prev,
                                notification_types: {
                                  ...prev.notification_types,
                                  [type.key]: e.target.checked
                                }
                              }))}
                              className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Calendar Tab */}
        {activeTab === 'calendar' && (
          <div className="bg-white rounded-xl shadow-sm border p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Google Calendar Integration</h2>
              
              {/* Success/Error Message */}
              {calendarMessage && (
                <div className={`mb-4 p-4 rounded-lg ${
                  calendarMessage.type === 'success' 
                    ? 'bg-green-50 border border-green-200 text-green-800' 
                    : 'bg-red-50 border border-red-200 text-red-800'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {calendarMessage.type === 'success' ? (
                        <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                      <span>{calendarMessage.text}</span>
                    </div>
                    <button 
                      onClick={() => setCalendarMessage(null)}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
              
              <div className="p-4 bg-gray-50 rounded-lg mb-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${googleToken ? 'bg-green-100' : 'bg-gray-200'}`}>
                      <svg className={`w-5 h-5 ${googleToken ? 'text-green-600' : 'text-gray-500'}`} viewBox="0 0 24 24">
                        <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                      </svg>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Google Calendar</p>
                      <p className="text-sm text-gray-500">
                        {googleToken ? 'Connected' : 'Not connected'}
                      </p>
                    </div>
                  </div>
                  {googleToken ? (
                    <button
                      onClick={disconnectGoogleCalendar}
                      className="px-4 py-2 text-red-600 border border-red-200 rounded-lg hover:bg-red-50 text-sm font-medium"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={connectGoogleCalendar}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>

              <h3 className="font-medium text-gray-900 mb-3">Scheduling Preferences</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Default Appointment Duration
                  </label>
                  <select
                    value={settings.default_appointment_duration}
                    onChange={(e) => setSettings(prev => ({ ...prev, default_appointment_duration: parseInt(e.target.value) }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value={30}>30 minutes</option>
                    <option value={45}>45 minutes</option>
                    <option value={60}>1 hour</option>
                    <option value={90}>1.5 hours</option>
                    <option value={120}>2 hours</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Buffer Between Appointments
                  </label>
                  <select
                    value={settings.appointment_buffer_minutes}
                    onChange={(e) => setSettings(prev => ({ ...prev, appointment_buffer_minutes: parseInt(e.target.value) }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value={0}>No buffer</option>
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={45}>45 minutes</option>
                    <option value={60}>1 hour</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Working Hours Start
                  </label>
                  <input
                    type="time"
                    value={settings.working_hours_start}
                    onChange={(e) => setSettings(prev => ({ ...prev, working_hours_start: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Working Hours End
                  </label>
                  <input
                    type="time"
                    value={settings.working_hours_end}
                    onChange={(e) => setSettings(prev => ({ ...prev, working_hours_end: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Working Days
                </label>
                <div className="flex gap-2">
                  {dayNames.map((day, index) => (
                    <button
                      key={day}
                      onClick={() => toggleWorkingDay(index)}
                      className={`w-12 h-12 rounded-lg font-medium text-sm ${
                        settings.working_days.includes(index)
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* AI Tab */}
        {activeTab === 'ai' && (
          <div className="bg-white rounded-xl shadow-sm border p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">AI Assistant</h2>
              <p className="text-gray-500 text-sm mb-4">
                A read-only assistant for CRM navigation and guidance — it does not edit records, send messages, or write notes on your behalf.
              </p>

              <div className="space-y-4">
                <label className="flex items-center justify-between p-4 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-indigo-100">
                  <div>
                    <p className="font-medium text-gray-900">Enable AI Assistant</p>
                    <p className="text-sm text-gray-500">Turn on the chat assistant for CRM navigation and workflow guidance</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={aiEnabled}
                    onChange={(e) => setAiEnabled(e.target.checked)}
                    className="w-5 h-5 rounded border-gray-300 text-indigo-600"
                  />
                </label>

                {aiEnabled && (
                  <>
                    <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">Smart Suggestions</p>
                        <p className="text-sm text-gray-500">Show suggested next actions on production jobs</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={aiSuggestionsEnabled}
                        onChange={(e) => setAiSuggestionsEnabled(e.target.checked)}
                        className="w-5 h-5 rounded border-gray-300 text-indigo-600"
                      />
                    </label>

                    <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-100">
                      <h3 className="font-medium text-indigo-900 mb-2">What the assistant actually does:</h3>
                      <ul className="text-sm text-indigo-700 space-y-1">
                        <li>• Answers questions about where things are in the CRM</li>
                        <li>• Explains CRM workflows and suggests next steps</li>
                        <li>• Shows read-only context for the lead, opportunity, project, or job you have open</li>
                        <li>• Suggests a next action on production jobs (Smart Suggestions, above)</li>
                        <li>• Never edits records, sends messages, or writes notes for you</li>
                      </ul>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Reports Tab */}
        {activeTab === 'reports' && (
          <div className="bg-white rounded-xl shadow-sm border p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">My Reports</h2>
              <p className="text-gray-500 text-sm mb-4">
                Create and manage custom reports based on your permissions
              </p>
              
              <div className="space-y-4">
                <a
                  href="/reports/builder"
                  className="flex items-center justify-between p-4 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors border border-indigo-100"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
                      <span className="text-xl">📊</span>
                    </div>
                    <div>
                      <p className="font-medium text-indigo-900">Create New Report</p>
                      <p className="text-sm text-indigo-600">Build a custom report with charts and metrics</p>
                    </div>
                  </div>
                  <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </a>

                <a
                  href="/reports"
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                      <span className="text-xl">📈</span>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">View All Reports</p>
                      <p className="text-sm text-gray-500">Access your reports and team dashboards</p>
                    </div>
                  </div>
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </a>

                <div className="p-4 bg-amber-50 rounded-lg border border-amber-100">
                  <h3 className="font-medium text-amber-900 mb-2">Report Permissions</h3>
                  <p className="text-sm text-amber-700">
                    You can create reports based on data you have access to. Reports you create can be:
                  </p>
                  <ul className="text-sm text-amber-700 mt-2 space-y-1">
                    <li>• <strong>Private</strong> - Only visible to you</li>
                    <li>• <strong>Public</strong> - Visible to your team (if you have permission)</li>
                    <li>• <strong>Dashboard Widget</strong> - Display on your dashboard</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Display Tab */}
        {activeTab === 'display' && (
          <div className="bg-white rounded-xl shadow-sm border p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Display Preferences</h2>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Theme
                </label>
                <div className="flex gap-3">
                  {[
                    { id: 'light', label: 'Light', icon: '☀️' },
                    { id: 'dark', label: 'Dark', icon: '🌙' },
                    { id: 'system', label: 'System', icon: '💻' },
                  ].map((theme) => (
                    <button
                      key={theme.id}
                      onClick={() => setSettings(prev => ({ ...prev, theme: theme.id }))}
                      className={`flex-1 p-4 rounded-lg border-2 text-center ${
                        settings.theme === theme.id
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <span className="text-2xl">{theme.icon}</span>
                      <p className="font-medium text-gray-900 mt-2">{theme.label}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Save Button */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={saveSettings}
            disabled={saving}
            className="px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
