'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Link from 'next/link'

interface DashboardSettingsData {
  widgets: string[]
  goals: {
    doors_knocked: number
    inspections: number
    sales: number
  }
  layout?: string
}

interface SettingsRecord {
  id: string
  org_id: string
  region_id: string | null
  team_id: string | null
  user_id: string | null
  settings: DashboardSettingsData
}

export default function DashboardSettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [profile, setProfile] = useState<any>(null)
  const [regions, setRegions] = useState<any[]>([])
  const [teams, setTeams] = useState<any[]>([])
  const [selectedScope, setSelectedScope] = useState<'org' | 'region' | 'team'>('org')
  const [selectedRegionId, setSelectedRegionId] = useState<string>('')
  const [selectedTeamId, setSelectedTeamId] = useState<string>('')
  const [settings, setSettings] = useState<DashboardSettingsData>({
    widgets: ['stats', 'progress', 'appointments', 'activity'],
    goals: { doors_knocked: 100, inspections: 20, sales: 5 },
  })
  const [existingSettings, setExistingSettings] = useState<SettingsRecord | null>(null)

  useEffect(() => {
    loadInitialData()
  }, [])

  useEffect(() => {
    if (profile?.org_id) {
      loadSettingsForScope()
    }
  }, [selectedScope, selectedRegionId, selectedTeamId, profile?.org_id])

  const loadInitialData = async () => {
    try {
      const response = await fetch('/api/admin/dashboard-settings')
      
      if (response.status === 401) {
        router.push('/login')
        return
      }
      
      if (response.status === 403) {
        router.push('/dashboard')
        return
      }
      
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to load data')
      }
      
      const data = await response.json()
      setProfile(data.profile)
      setRegions(data.regions || [])
      setTeams(data.teams || [])
      
      if (data.settings) {
        setExistingSettings(data.settings)
        setSettings(data.settings.settings)
      }
    } catch (err) {
      console.error('Error loading data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const loadSettingsForScope = async () => {
    if (!profile?.org_id) return
    
    // Don't load if scope requires selection but none made
    if (selectedScope === 'region' && !selectedRegionId) return
    if (selectedScope === 'team' && !selectedTeamId) return

    try {
      const params = new URLSearchParams({ scope: selectedScope })
      if (selectedScope === 'region' && selectedRegionId) {
        params.set('region_id', selectedRegionId)
      }
      if (selectedScope === 'team' && selectedTeamId) {
        params.set('team_id', selectedTeamId)
      }

      const response = await fetch(`/api/admin/dashboard-settings?${params}`)
      
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to load settings')
      }
      
      const data = await response.json()
      
      if (data.settings) {
        setExistingSettings(data.settings)
        setSettings(data.settings.settings)
      } else {
        setExistingSettings(null)
        setSettings({
          widgets: ['stats', 'progress', 'appointments', 'activity'],
          goals: { doors_knocked: 100, inspections: 20, sales: 5 },
        })
      }
    } catch (err) {
      console.error('Error loading settings:', err)
    }
  }

  const handleSave = async () => {
    if (!profile?.org_id) return
    
    // Validate scope selection
    if (selectedScope === 'region' && !selectedRegionId) {
      setError('Please select a region')
      return
    }
    if (selectedScope === 'team' && !selectedTeamId) {
      setError('Please select a team')
      return
    }
    
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const response = await fetch('/api/admin/dashboard-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: selectedScope,
          region_id: selectedScope === 'region' ? selectedRegionId : null,
          team_id: selectedScope === 'team' ? selectedTeamId : null,
          settings,
          existing_id: existingSettings?.id || null,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save settings')
      }

      setSuccess(true)
      setExistingSettings(data.settings)
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      console.error('Error saving settings:', err)
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const widgetOptions = [
    { id: 'stats', label: 'Quick Stats', description: 'Doors knocked, inspections, sales, close rate' },
    { id: 'progress', label: 'Weekly Progress', description: 'Progress bars toward weekly goals' },
    { id: 'appointments', label: 'Upcoming Appointments', description: 'List of scheduled appointments' },
    { id: 'activity', label: 'Recent Activity', description: 'Activity feed from team members' },
    { id: 'leaderboard', label: 'Leaderboard', description: 'Top performers this week' },
    { id: 'pipeline', label: 'Pipeline Overview', description: 'Leads, opportunities, projects summary' },
  ]

  const toggleWidget = (widgetId: string) => {
    setSettings(prev => ({
      ...prev,
      widgets: prev.widgets.includes(widgetId)
        ? prev.widgets.filter(w => w !== widgetId)
        : [...prev.widgets, widgetId],
    }))
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/3 mb-8"></div>
            <div className="space-y-4">
              <div className="h-32 bg-gray-200 rounded"></div>
              <div className="h-32 bg-gray-200 rounded"></div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/admin" className="text-sm text-indigo-600 hover:text-indigo-700 mb-2 inline-block">
              ← Back to Admin
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard Settings</h1>
            <p className="text-gray-500 mt-1">
              Customize dashboard for your organization, regions, or teams
            </p>
          </div>
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
        
        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-700">Settings saved successfully!</p>
          </div>
        )}

        {/* Scope Selection */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Settings Scope</h2>
          <p className="text-sm text-gray-500 mb-4">
            Choose which level to configure. Team settings override region settings, which override org-wide defaults.
          </p>
          
          <div className="grid grid-cols-3 gap-4 mb-4">
            <button
              onClick={() => {
                setSelectedScope('org')
                setSelectedRegionId('')
                setSelectedTeamId('')
              }}
              className={`p-4 rounded-lg border-2 text-left transition-colors ${
                selectedScope === 'org'
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <p className="font-semibold text-gray-900">Organization</p>
              <p className="text-sm text-gray-500">Default for all users</p>
            </button>
            <button
              onClick={() => {
                setSelectedScope('region')
                setSelectedTeamId('')
              }}
              className={`p-4 rounded-lg border-2 text-left transition-colors ${
                selectedScope === 'region'
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <p className="font-semibold text-gray-900">Region</p>
              <p className="text-sm text-gray-500">Override for a region</p>
            </button>
            <button
              onClick={() => {
                setSelectedScope('team')
                setSelectedRegionId('')
              }}
              className={`p-4 rounded-lg border-2 text-left transition-colors ${
                selectedScope === 'team'
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <p className="font-semibold text-gray-900">Team</p>
              <p className="text-sm text-gray-500">Override for a team</p>
            </button>
          </div>

          {selectedScope === 'region' && (
            <div>
              <select
                value={selectedRegionId}
                onChange={(e) => setSelectedRegionId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Select a region...</option>
                {regions.map(region => (
                  <option key={region.id} value={region.id}>{region.name}</option>
                ))}
              </select>
              {regions.length === 0 && (
                <p className="text-sm text-amber-600 mt-2">
                  No regions found. <Link href="/admin/teams" className="underline">Create regions first</Link>.
                </p>
              )}
            </div>
          )}

          {selectedScope === 'team' && (
            <div>
              <select
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Select a team...</option>
                {teams.map(team => (
                  <option key={team.id} value={team.id}>
                    {team.name} {team.regions?.name ? `(${team.regions.name})` : ''}
                  </option>
                ))}
              </select>
              {teams.length === 0 && (
                <p className="text-sm text-amber-600 mt-2">
                  No teams found. <Link href="/admin/teams" className="underline">Create teams first</Link>.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Widget Selection */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Dashboard Widgets</h2>
          <p className="text-sm text-gray-500 mb-4">
            Select which widgets to show on the dashboard
          </p>
          
          <div className="space-y-3">
            {widgetOptions.map(widget => (
              <label
                key={widget.id}
                className={`flex items-center gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
                  settings.widgets.includes(widget.id)
                    ? 'border-indigo-500 bg-indigo-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={settings.widgets.includes(widget.id)}
                  onChange={() => toggleWidget(widget.id)}
                  className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500"
                />
                <div>
                  <p className="font-medium text-gray-900">{widget.label}</p>
                  <p className="text-sm text-gray-500">{widget.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Goals */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Weekly Goals</h2>
          <p className="text-sm text-gray-500 mb-4">
            Set weekly targets for progress tracking
          </p>
          
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Doors Knocked
              </label>
              <input
                type="number"
                value={settings.goals.doors_knocked}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  goals: { ...prev.goals, doors_knocked: parseInt(e.target.value) || 0 }
                }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Inspections Set
              </label>
              <input
                type="number"
                value={settings.goals.inspections}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  goals: { ...prev.goals, inspections: parseInt(e.target.value) || 0 }
                }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Sales Closed
              </label>
              <input
                type="number"
                value={settings.goals.sales}
                onChange={(e) => setSettings(prev => ({
                  ...prev,
                  goals: { ...prev.goals, sales: parseInt(e.target.value) || 0 }
                }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end gap-4">
          {existingSettings && (
            <span className="text-sm text-gray-500 self-center">
              Last updated: {new Date(existingSettings.settings ? Date.now() : 0).toLocaleDateString()}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || (selectedScope === 'region' && !selectedRegionId) || (selectedScope === 'team' && !selectedTeamId)}
            className="px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Saving...
              </>
            ) : (
              'Save Settings'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
