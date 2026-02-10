'use client'

import { useState, useEffect } from 'react'
import { createClientBrowser } from '@/lib/supabase/client'
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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
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

  const supabase = createClientBrowser()

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (profile?.org_id) {
      loadSettingsForScope()
    }
  }, [selectedScope, selectedRegionId, selectedTeamId, profile?.org_id])

  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profileData } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single()

      if (!profileData) return
      setProfile(profileData)

      // Check permissions
      if (!['admin', 'regional_manager'].includes(profileData.role)) {
        window.location.href = '/dashboard'
        return
      }

      // Load regions and teams
      const { data: regionsData } = await supabase
        .from('regions')
        .select('*')
        .eq('org_id', profileData.org_id)
        .order('name')

      setRegions(regionsData || [])

      const { data: teamsData } = await supabase
        .from('teams')
        .select('*, regions(name)')
        .eq('org_id', profileData.org_id)
        .order('name')

      setTeams(teamsData || [])
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadSettingsForScope = async () => {
    if (!profile?.org_id) return

    let query = supabase
      .from('dashboard_settings')
      .select('*')
      .eq('org_id', profile.org_id)

    if (selectedScope === 'org') {
      query = query.is('region_id', null).is('team_id', null).is('user_id', null)
    } else if (selectedScope === 'region' && selectedRegionId) {
      query = query.eq('region_id', selectedRegionId).is('team_id', null).is('user_id', null)
    } else if (selectedScope === 'team' && selectedTeamId) {
      query = query.eq('team_id', selectedTeamId).is('user_id', null)
    } else {
      return
    }

    const { data } = await query.single()

    if (data) {
      setExistingSettings(data)
      setSettings(data.settings)
    } else {
      setExistingSettings(null)
      setSettings({
        widgets: ['stats', 'progress', 'appointments', 'activity'],
        goals: { doors_knocked: 100, inspections: 20, sales: 5 },
      })
    }
  }

  const handleSave = async () => {
    if (!profile?.org_id) return
    setSaving(true)

    try {
      const settingsData: any = {
        org_id: profile.org_id,
        settings,
        region_id: selectedScope === 'region' ? selectedRegionId : null,
        team_id: selectedScope === 'team' ? selectedTeamId : null,
        user_id: null,
      }

      if (existingSettings) {
        await supabase
          .from('dashboard_settings')
          .update({ settings, updated_at: new Date().toISOString() })
          .eq('id', existingSettings.id)
      } else {
        await supabase
          .from('dashboard_settings')
          .insert(settingsData)
      }

      alert('Settings saved successfully!')
      loadSettingsForScope()
    } catch (error) {
      console.error('Error saving settings:', error)
      alert('Failed to save settings')
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

        {/* Scope Selection */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Settings Scope</h2>
          <p className="text-sm text-gray-500 mb-4">
            Choose which level to configure. Team settings override region settings, which override org-wide defaults.
          </p>
          
          <div className="grid grid-cols-3 gap-4 mb-4">
            <button
              onClick={() => setSelectedScope('org')}
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
              onClick={() => setSelectedScope('region')}
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
              onClick={() => setSelectedScope('team')}
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
          )}

          {selectedScope === 'team' && (
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
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving || (selectedScope === 'region' && !selectedRegionId) || (selectedScope === 'team' && !selectedTeamId)}
            className="px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
