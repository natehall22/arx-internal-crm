'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Image from 'next/image'

type SettingsSection = 
  | 'contact-fields' 
  | 'contact-workflows' 
  | 'job-fields' 
  | 'job-workflows'
  | 'work-order-fields'
  | 'work-order-workflows'
  | 'canvass-dispositions'
  | 'estimate-settings'
  | 'appointment-settings'
  | 'budgets'
  | 'capital'
  | 'commissions'
  | 'quickbooks'
  | 'integrations'
  | 'measurement-tools'
  | 'notifications'
  | 'general'

interface AppointmentType {
  id: string
  name: string
  duration_minutes: number
  color: string
  active: boolean
  description?: string
}

interface DispositionType {
  id: string
  label: string
  category: string
  color: string
  active: boolean
  sort_order: number
}

interface CustomField {
  id: string
  name: string
  field_type: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea'
  options?: string[]
  required: boolean
  entity_type: 'contact' | 'lead' | 'opportunity' | 'project'
  sort_order: number
  active: boolean
}

interface WorkflowStage {
  id: string
  name: string
  color: string
  sort_order: number
  auto_actions?: string[]
}

export default function AdminSettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const [saving, setSaving] = useState(false)
  
  // Settings state
  const [customFields, setCustomFields] = useState<CustomField[]>([])
  const [workflowStages, setWorkflowStages] = useState<Record<string, WorkflowStage[]>>({})
  const [estimateSettings, setEstimateSettings] = useState({
    default_tax_rate: 8.25,
    steep_multiplier: 15,
    high_multiplier: 25,
    include_labor_in_tax: false,
    default_validity_days: 30,
    require_signature: true,
  })
  const [integrationSettings, setIntegrationSettings] = useState({
    quickbooks_connected: false,
    quickbooks_company_id: '',
    quickbooks_sync_invoices: true,
    quickbooks_sync_customers: true,
    quickbooks_sync_payments: true,
  })
  const [generalSettings, setGeneralSettings] = useState({
    company_name: '',
    company_phone: '',
    company_email: '',
    company_address: '',
    timezone: 'America/Chicago',
    date_format: 'MM/DD/YYYY',
    currency: 'USD',
  })
  const [commissionSettings, setCommissionSettings] = useState({
    commission_period: 'monthly' as 'weekly' | 'bi-weekly' | 'monthly',
    week_start_day: 0 as number, // 0 = Sunday, 1 = Monday, etc.
    bi_weekly_start_date: '', // Reference date for bi-weekly periods
  })
  const [measurementSettings, setMeasurementSettings] = useState({
    measure_tool_enabled: true,
    preferred_provider: 'in_house', // 'in_house', 'eagleview', 'roofr', 'solo', 'aurora'
    eagleview_enabled: false,
    roofr_enabled: false,
    solo_enabled: false,
    aurora_enabled: false,
  })
  const [dispositions, setDispositions] = useState<DispositionType[]>([
    { id: 'not_home', label: 'Not Home', category: 'No Contact', color: '#ef4444', active: true, sort_order: 0 },
    { id: 'bad_roof', label: 'Bad Roof', category: 'No Contact', color: '#f97316', active: true, sort_order: 1 },
    { id: 'renter', label: 'Renter', category: 'Unqualified', color: '#eab308', active: true, sort_order: 2 },
    { id: 'go_back', label: 'Go Back', category: 'Contact', color: '#3b82f6', active: true, sort_order: 3 },
    { id: 'hot_lead', label: 'Hot Lead', category: 'Contact', color: '#22c55e', active: true, sort_order: 4 },
    { id: 'not_interested', label: 'Not Interested', category: 'Closed', color: '#6b7280', active: true, sort_order: 5 },
  ])
  const [editingDisposition, setEditingDisposition] = useState<DispositionType | null>(null)
  const [showAddDisposition, setShowAddDisposition] = useState(false)
  
  // Appointment types
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([
    { id: 'inspection', name: 'Inspection', duration_minutes: 60, color: '#3b82f6', active: true, description: 'Standard roof inspection' },
    { id: 'follow_up', name: 'Follow Up', duration_minutes: 30, color: '#22c55e', active: true, description: 'Follow up visit' },
    { id: 'contract_signing', name: 'Contract Signing', duration_minutes: 45, color: '#8b5cf6', active: true, description: 'Contract signing appointment' },
    { id: 'final_walkthrough', name: 'Final Walkthrough', duration_minutes: 30, color: '#f59e0b', active: true, description: 'Post-installation walkthrough' },
  ])
  const [editingAppointmentType, setEditingAppointmentType] = useState<AppointmentType | null>(null)
  const [showAddAppointmentType, setShowAddAppointmentType] = useState(false)
  
  // Logo state
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [userRole, setUserRole] = useState<string>('')
  const logoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/admin/settings')
      
      if (response.status === 401) {
        router.push('/login')
        return
      }
      
      if (response.status === 403) {
        router.push('/dashboard')
        return
      }
      
      if (!response.ok) {
        console.error('Failed to load settings')
        setLoading(false)
        return
      }
      
      const data = await response.json()
      
      if (data.org) {
        setGeneralSettings({
          company_name: data.org.name || '',
          company_phone: data.org.phone || data.settings?.company_phone || '',
          company_email: data.org.email || data.settings?.company_email || '',
          company_address: data.org.address || data.settings?.company_address || '',
          timezone: data.org.timezone || data.settings?.timezone || 'America/Chicago',
          date_format: data.org.date_format || data.settings?.date_format || 'MM/DD/YYYY',
          currency: data.org.currency || data.settings?.currency || 'USD',
        })
        // Load logo URL
        setLogoUrl(data.org.logo_url || data.settings?.logo_url || null)
      }
      
      // Store user role
      if (data.role) {
        setUserRole(data.role)
      }
      
      // Load canvass dispositions from org settings
      if (data.settings?.canvass_dispositions) {
        setDispositions(data.settings.canvass_dispositions)
      }
      
      // Load commission settings
      if (data.settings?.commission) {
        setCommissionSettings(prev => ({
          ...prev,
          ...data.settings.commission
        }))
      }
      
      // Load measurement settings
      if (data.settings?.measure_tool_enabled !== undefined) {
        setMeasurementSettings(prev => ({
          ...prev,
          measure_tool_enabled: data.settings.measure_tool_enabled,
          ...(data.settings.external_integrations || {}),
        }))
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
      const response = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'general',
          ...generalSettings,
        }),
      })
      
      if (!response.ok) {
        const data = await response.json()
        alert(data.error || 'Failed to save settings')
        return
      }
      
      alert('Settings saved!')
    } catch (error) {
      console.error('Error saving settings:', error)
      alert('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml']
    if (!allowedTypes.includes(file.type)) {
      alert('Invalid file type. Please upload a PNG, JPG, WEBP, or SVG image.')
      return
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert('File too large. Maximum size is 2MB.')
      return
    }

    setUploadingLogo(true)
    try {
      const formData = new FormData()
      formData.append('logo', file)

      const response = await fetch('/api/admin/logo', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const data = await response.json()
        alert(data.error || 'Failed to upload logo')
        return
      }

      const data = await response.json()
      setLogoUrl(data.logo_url)
      alert('Logo uploaded successfully!')
    } catch (error) {
      console.error('Error uploading logo:', error)
      alert('Failed to upload logo')
    } finally {
      setUploadingLogo(false)
      // Reset the input
      if (logoInputRef.current) {
        logoInputRef.current.value = ''
      }
    }
  }

  const handleLogoRemove = async () => {
    if (!confirm('Are you sure you want to remove the company logo?')) return

    setUploadingLogo(true)
    try {
      const response = await fetch('/api/admin/logo', {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        alert(data.error || 'Failed to remove logo')
        return
      }

      setLogoUrl(null)
      alert('Logo removed successfully!')
    } catch (error) {
      console.error('Error removing logo:', error)
      alert('Failed to remove logo')
    } finally {
      setUploadingLogo(false)
    }
  }

  const menuSections = [
    {
      title: 'WORKFLOWS & FIELDS',
      items: [
        { id: 'contact-fields', label: 'Contact Fields' },
        { id: 'contact-workflows', label: 'Contact Workflows' },
        { id: 'job-fields', label: 'Project Fields' },
        { id: 'job-workflows', label: 'Project Workflows' },
        { id: 'work-order-fields', label: 'Work Order Fields' },
        { id: 'work-order-workflows', label: 'Work Order Workflows' },
        { id: 'canvass-dispositions', label: 'Canvass Dispositions' },
      ],
    },
    {
      title: 'ESTIMATING',
      items: [
        { id: 'estimate-settings', label: 'Estimate Settings' },
      ],
    },
    {
      title: 'SCHEDULING',
      items: [
        { id: 'appointment-settings', label: 'Appointment Types' },
      ],
    },
    {
      title: 'FINANCIALS',
      items: [
        { id: 'budgets', label: 'Budgets' },
        { id: 'capital', label: 'Capital' },
        { id: 'commissions', label: 'Commissions' },
      ],
    },
    {
      title: 'INTEGRATIONS',
      items: [
        { id: 'quickbooks', label: 'QuickBooks' },
        { id: 'measurement-tools', label: 'Measurement Tools' },
        { id: 'integrations', label: 'Other Integrations' },
      ],
    },
    {
      title: 'SYSTEM',
      items: [
        { id: 'general', label: 'General Settings' },
        { id: 'notifications', label: 'Notification Templates' },
      ],
    },
  ]

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
      <div className="flex">
        {/* Sidebar */}
        <div className="w-64 bg-white border-r min-h-[calc(100vh-64px)] flex-shrink-0">
          <div className="p-4 border-b">
            <h2 className="font-semibold text-gray-900">Admin Settings</h2>
          </div>
          <nav className="p-4 space-y-6 overflow-y-auto max-h-[calc(100vh-130px)]">
            {menuSections.map((section) => (
              <div key={section.title}>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  {section.title}
                </h3>
                <ul className="space-y-1">
                  {section.items.map((item) => (
                    <li key={item.id}>
                      <button
                        onClick={() => setActiveSection(item.id as SettingsSection)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          activeSection === item.id
                            ? 'bg-indigo-50 text-indigo-700 font-medium'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* Main content */}
        <div className="flex-1 p-8">
          {/* General Settings */}
          {activeSection === 'general' && (
            <div className="max-w-2xl">
              <h1 className="text-2xl font-bold text-gray-900 mb-6">General Settings</h1>
              
              {/* Company Logo Section - Admin Only */}
              {userRole === 'admin' && (
                <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Company Logo</h2>
                  <p className="text-sm text-gray-500 mb-4">
                    Upload your company logo. This will be visible to all team members and can be used on proposals and documents.
                  </p>
                  
                  <div className="flex items-start gap-6">
                    {/* Logo Preview */}
                    <div className="flex-shrink-0">
                      {logoUrl ? (
                        <div className="relative w-32 h-32 border-2 border-gray-200 rounded-xl overflow-hidden bg-gray-50">
                          <Image
                            src={logoUrl}
                            alt="Company Logo"
                            fill
                            className="object-contain p-2"
                            unoptimized
                          />
                        </div>
                      ) : (
                        <div className="w-32 h-32 border-2 border-dashed border-gray-300 rounded-xl flex items-center justify-center bg-gray-50">
                          <div className="text-center">
                            <svg className="w-10 h-10 text-gray-400 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <span className="text-xs text-gray-400">No logo</span>
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {/* Upload Controls */}
                    <div className="flex-1">
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
                        onChange={handleLogoUpload}
                        className="hidden"
                        id="logo-upload"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => logoInputRef.current?.click()}
                          disabled={uploadingLogo}
                          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
                        >
                          {uploadingLogo ? 'Uploading...' : logoUrl ? 'Change Logo' : 'Upload Logo'}
                        </button>
                        {logoUrl && (
                          <button
                            onClick={handleLogoRemove}
                            disabled={uploadingLogo}
                            className="px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50 text-sm font-medium"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        Accepted formats: PNG, JPG, WEBP, SVG. Max size: 2MB.
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Recommended: Square image, at least 200x200 pixels.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="bg-white rounded-xl shadow-sm border p-6 space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Company Name</label>
                  <input
                    type="text"
                    value={generalSettings.company_name}
                    onChange={(e) => setGeneralSettings(prev => ({ ...prev, company_name: e.target.value }))}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                    <input
                      type="tel"
                      value={generalSettings.company_phone}
                      onChange={(e) => setGeneralSettings(prev => ({ ...prev, company_phone: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                    <input
                      type="email"
                      value={generalSettings.company_email}
                      onChange={(e) => setGeneralSettings(prev => ({ ...prev, company_email: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Address</label>
                  <textarea
                    value={generalSettings.company_address}
                    onChange={(e) => setGeneralSettings(prev => ({ ...prev, company_address: e.target.value }))}
                    rows={2}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Timezone</label>
                    <select
                      value={generalSettings.timezone}
                      onChange={(e) => setGeneralSettings(prev => ({ ...prev, timezone: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    >
                      <option value="America/New_York">Eastern</option>
                      <option value="America/Chicago">Central</option>
                      <option value="America/Denver">Mountain</option>
                      <option value="America/Los_Angeles">Pacific</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Date Format</label>
                    <select
                      value={generalSettings.date_format}
                      onChange={(e) => setGeneralSettings(prev => ({ ...prev, date_format: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    >
                      <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                      <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                      <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Currency</label>
                    <select
                      value={generalSettings.currency}
                      onChange={(e) => setGeneralSettings(prev => ({ ...prev, currency: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    >
                      <option value="USD">USD ($)</option>
                      <option value="CAD">CAD ($)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="GBP">GBP (£)</option>
                    </select>
                  </div>
                </div>

                <div className="pt-4 border-t">
                  <button
                    onClick={saveSettings}
                    disabled={saving}
                    className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Estimate Settings */}
          {activeSection === 'estimate-settings' && (
            <div className="max-w-2xl">
              <h1 className="text-2xl font-bold text-gray-900 mb-6">Estimate Settings</h1>
              
              <div className="bg-white rounded-xl shadow-sm border p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Default Tax Rate (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={estimateSettings.default_tax_rate}
                      onChange={(e) => setEstimateSettings(prev => ({ ...prev, default_tax_rate: parseFloat(e.target.value) }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Estimate Validity (days)</label>
                    <input
                      type="number"
                      value={estimateSettings.default_validity_days}
                      onChange={(e) => setEstimateSettings(prev => ({ ...prev, default_validity_days: parseInt(e.target.value) }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Steep Roof Multiplier (%)</label>
                    <input
                      type="number"
                      value={estimateSettings.steep_multiplier}
                      onChange={(e) => setEstimateSettings(prev => ({ ...prev, steep_multiplier: parseInt(e.target.value) }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">High Roof Multiplier (%)</label>
                    <input
                      type="number"
                      value={estimateSettings.high_multiplier}
                      onChange={(e) => setEstimateSettings(prev => ({ ...prev, high_multiplier: parseInt(e.target.value) }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={estimateSettings.include_labor_in_tax}
                      onChange={(e) => setEstimateSettings(prev => ({ ...prev, include_labor_in_tax: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                    />
                    <span className="text-sm text-gray-700">Include labor in tax calculation</span>
                  </label>
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={estimateSettings.require_signature}
                      onChange={(e) => setEstimateSettings(prev => ({ ...prev, require_signature: e.target.checked }))}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                    />
                    <span className="text-sm text-gray-700">Require customer signature on estimates</span>
                  </label>
                </div>

                <div className="pt-4 border-t">
                  <button
                    onClick={saveSettings}
                    disabled={saving}
                    className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Appointment Settings */}
          {activeSection === 'appointment-settings' && (
            <div className="max-w-3xl">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Appointment Types</h1>
                  <p className="text-gray-500 mt-1">Configure appointment types and their default durations.</p>
                </div>
                <button
                  onClick={() => {
                    setEditingAppointmentType({
                      id: `apt_${Date.now()}`,
                      name: '',
                      duration_minutes: 60,
                      color: '#3b82f6',
                      active: true,
                      description: '',
                    })
                    setShowAddAppointmentType(true)
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
                >
                  + Add Appointment Type
                </button>
              </div>

              {/* Appointment Types List */}
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Color</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {appointmentTypes.map((apt) => (
                      <tr key={apt.id} className={!apt.active ? 'bg-gray-50 opacity-60' : ''}>
                        <td className="px-4 py-3">
                          <div
                            className="w-8 h-8 rounded-full border-2 border-white shadow"
                            style={{ backgroundColor: apt.color }}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <span className="font-medium text-gray-900">{apt.name}</span>
                            {apt.description && (
                              <p className="text-xs text-gray-500">{apt.description}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-700">{apt.duration_minutes} minutes</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            apt.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {apt.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => {
                              setEditingAppointmentType(apt)
                              setShowAddAppointmentType(true)
                            }}
                            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium mr-3"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              setAppointmentTypes(prev => prev.map(a => 
                                a.id === apt.id ? { ...a, active: !a.active } : a
                              ))
                            }}
                            className="text-gray-500 hover:text-gray-700 text-sm"
                          >
                            {apt.active ? 'Disable' : 'Enable'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Save Button */}
              <div className="mt-6 flex justify-end">
                <button
                  onClick={async () => {
                    setSaving(true)
                    try {
                      const response = await fetch('/api/admin/settings', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          type: 'appointment_types',
                          appointment_types: appointmentTypes,
                        }),
                      })
                      
                      if (!response.ok) {
                        const data = await response.json()
                        alert(data.error || 'Failed to save appointment types')
                        return
                      }
                      
                      alert('Appointment types saved!')
                    } catch (error) {
                      console.error('Error saving appointment types:', error)
                      alert('Failed to save appointment types')
                    } finally {
                      setSaving(false)
                    }
                  }}
                  disabled={saving}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Appointment Types'}
                </button>
              </div>

              {/* Default Duration Info */}
              <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-100">
                <h4 className="font-medium text-blue-900 mb-2">How Appointment Durations Work</h4>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• When scheduling an appointment, the duration will default to the type's setting</li>
                  <li>• Reps can override the duration for individual appointments if needed</li>
                  <li>• Calendar events will be created with the specified duration</li>
                  <li>• Feedback prompts will trigger after the appointment end time</li>
                </ul>
              </div>

              {/* Edit/Add Modal */}
              {showAddAppointmentType && editingAppointmentType && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
                    <div className="p-6 border-b">
                      <h2 className="text-xl font-bold text-gray-900">
                        {appointmentTypes.find(a => a.id === editingAppointmentType.id) ? 'Edit Appointment Type' : 'Add Appointment Type'}
                      </h2>
                    </div>
                    <div className="p-6 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Name *</label>
                        <input
                          type="text"
                          value={editingAppointmentType.name}
                          onChange={(e) => setEditingAppointmentType(prev => prev ? { ...prev, name: e.target.value } : null)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                          placeholder="e.g., Inspection, Follow Up"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                        <input
                          type="text"
                          value={editingAppointmentType.description || ''}
                          onChange={(e) => setEditingAppointmentType(prev => prev ? { ...prev, description: e.target.value } : null)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                          placeholder="Brief description"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Duration (minutes) *</label>
                        <select
                          value={editingAppointmentType.duration_minutes}
                          onChange={(e) => setEditingAppointmentType(prev => prev ? { ...prev, duration_minutes: parseInt(e.target.value) } : null)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                        >
                          <option value={15}>15 minutes</option>
                          <option value={30}>30 minutes</option>
                          <option value={45}>45 minutes</option>
                          <option value={60}>1 hour</option>
                          <option value={90}>1.5 hours</option>
                          <option value={120}>2 hours</option>
                          <option value={150}>2.5 hours</option>
                          <option value={180}>3 hours</option>
                          <option value={240}>4 hours</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
                        <div className="flex gap-2 flex-wrap">
                          {[
                            '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', 
                            '#8b5cf6', '#ec4899', '#6b7280', '#14b8a6', '#f43f5e'
                          ].map((color) => (
                            <button
                              key={color}
                              type="button"
                              onClick={() => setEditingAppointmentType(prev => prev ? { ...prev, color } : null)}
                              className={`w-10 h-10 rounded-full border-2 ${
                                editingAppointmentType.color === color ? 'border-gray-900 scale-110' : 'border-transparent'
                              }`}
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          id="apt-active"
                          checked={editingAppointmentType.active}
                          onChange={(e) => setEditingAppointmentType(prev => prev ? { ...prev, active: e.target.checked } : null)}
                          className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                        />
                        <label htmlFor="apt-active" className="text-sm text-gray-700">Active</label>
                      </div>
                    </div>
                    <div className="p-6 border-t flex justify-between">
                      {appointmentTypes.find(a => a.id === editingAppointmentType.id) && (
                        <button
                          onClick={() => {
                            if (confirm('Delete this appointment type?')) {
                              setAppointmentTypes(prev => prev.filter(a => a.id !== editingAppointmentType.id))
                              setShowAddAppointmentType(false)
                              setEditingAppointmentType(null)
                            }
                          }}
                          className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                        >
                          Delete
                        </button>
                      )}
                      <div className="flex gap-3 ml-auto">
                        <button
                          onClick={() => {
                            setShowAddAppointmentType(false)
                            setEditingAppointmentType(null)
                          }}
                          className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            if (!editingAppointmentType.name) {
                              alert('Please enter a name')
                              return
                            }
                            const exists = appointmentTypes.find(a => a.id === editingAppointmentType.id)
                            if (exists) {
                              setAppointmentTypes(prev => prev.map(a => 
                                a.id === editingAppointmentType.id ? editingAppointmentType : a
                              ))
                            } else {
                              setAppointmentTypes(prev => [...prev, editingAppointmentType])
                            }
                            setShowAddAppointmentType(false)
                            setEditingAppointmentType(null)
                          }}
                          className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* QuickBooks Integration */}
          {activeSection === 'quickbooks' && (
            <div className="max-w-2xl">
              <h1 className="text-2xl font-bold text-gray-900 mb-6">QuickBooks Integration</h1>
              
              <div className="bg-white rounded-xl shadow-sm border p-6 space-y-6">
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                      <svg className="w-8 h-8 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">QuickBooks Online</h3>
                      <p className="text-sm text-gray-500">
                        {integrationSettings.quickbooks_connected 
                          ? `Connected to ${integrationSettings.quickbooks_company_id}`
                          : 'Not connected'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      // QuickBooks OAuth flow would go here
                      alert('QuickBooks OAuth integration - would redirect to Intuit')
                    }}
                    className={`px-4 py-2 rounded-lg font-medium ${
                      integrationSettings.quickbooks_connected
                        ? 'text-red-600 border border-red-200 hover:bg-red-50'
                        : 'bg-green-600 text-white hover:bg-green-700'
                    }`}
                  >
                    {integrationSettings.quickbooks_connected ? 'Disconnect' : 'Connect'}
                  </button>
                </div>

                {integrationSettings.quickbooks_connected && (
                  <>
                    <div className="border-t pt-6">
                      <h3 className="font-medium text-gray-900 mb-4">Sync Settings</h3>
                      <div className="space-y-3">
                        <label className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div>
                            <p className="font-medium text-gray-900">Sync Invoices</p>
                            <p className="text-sm text-gray-500">Automatically create invoices in QuickBooks</p>
                          </div>
                          <input
                            type="checkbox"
                            checked={integrationSettings.quickbooks_sync_invoices}
                            onChange={(e) => setIntegrationSettings(prev => ({ ...prev, quickbooks_sync_invoices: e.target.checked }))}
                            className="w-5 h-5 rounded border-gray-300 text-indigo-600"
                          />
                        </label>
                        <label className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div>
                            <p className="font-medium text-gray-900">Sync Customers</p>
                            <p className="text-sm text-gray-500">Create customers in QuickBooks when projects are created</p>
                          </div>
                          <input
                            type="checkbox"
                            checked={integrationSettings.quickbooks_sync_customers}
                            onChange={(e) => setIntegrationSettings(prev => ({ ...prev, quickbooks_sync_customers: e.target.checked }))}
                            className="w-5 h-5 rounded border-gray-300 text-indigo-600"
                          />
                        </label>
                        <label className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                          <div>
                            <p className="font-medium text-gray-900">Sync Payments</p>
                            <p className="text-sm text-gray-500">Record payments in QuickBooks when collected</p>
                          </div>
                          <input
                            type="checkbox"
                            checked={integrationSettings.quickbooks_sync_payments}
                            onChange={(e) => setIntegrationSettings(prev => ({ ...prev, quickbooks_sync_payments: e.target.checked }))}
                            className="w-5 h-5 rounded border-gray-300 text-indigo-600"
                          />
                        </label>
                      </div>
                    </div>

                    <div className="pt-4 border-t">
                      <button
                        onClick={saveSettings}
                        disabled={saving}
                        className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {saving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-100">
                <h4 className="font-medium text-blue-900 mb-2">How QuickBooks Integration Works</h4>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• When a project is marked as complete, an invoice is created in QuickBooks</li>
                  <li>• Customer records are synced to keep both systems in sync</li>
                  <li>• Payments recorded in ARX CRM are reflected in QuickBooks</li>
                  <li>• Commission reports can be exported for payroll processing</li>
                </ul>
              </div>
            </div>
          )}

          {/* Measurement Tools */}
          {activeSection === 'measurement-tools' && (
            <div className="max-w-2xl">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Measurement Tools</h1>
              <p className="text-gray-500 mb-6">Configure roof measurement tools and integrations for your team.</p>
              
              {/* In-House Tool */}
              <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-indigo-100 rounded-lg flex items-center justify-center">
                      <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">ARX Roof Measure</h3>
                      <p className="text-sm text-gray-500">In-house satellite measurement tool</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={measurementSettings.measure_tool_enabled}
                      onChange={(e) => setMeasurementSettings(prev => ({ ...prev, measure_tool_enabled: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                  </label>
                </div>
                <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-4">
                  <p className="mb-2"><strong>Features:</strong></p>
                  <ul className="list-disc list-inside space-y-1 text-gray-500">
                    <li>Draw roof planes on satellite imagery</li>
                    <li>Automatic area calculation with pitch adjustment</li>
                    <li>Ridge, hip, valley, eave, and rake measurements</li>
                    <li>Waste factor recommendations</li>
                    <li>No per-report fees</li>
                  </ul>
                </div>
              </div>

              {/* External Integrations */}
              <h2 className="text-lg font-semibold text-gray-900 mb-4">External Measurement Providers</h2>
              <p className="text-sm text-gray-500 mb-4">
                Connect to third-party measurement services. When enabled, these options will appear in the opportunity workflow.
              </p>
              
              <div className="space-y-4">
                {[
                  { 
                    key: 'eagleview_enabled',
                    name: 'EagleView', 
                    description: 'Premium aerial measurement reports', 
                    icon: '🦅',
                    features: ['High-resolution imagery', 'Detailed reports', 'Material estimates'],
                  },
                  { 
                    key: 'roofr_enabled',
                    name: 'Roofr', 
                    description: 'Fast satellite measurements', 
                    icon: '🏠',
                    features: ['Quick turnaround', 'Instant estimates', 'API integration'],
                  },
                  { 
                    key: 'solo_enabled',
                    name: 'Solo', 
                    description: 'Solar & roofing measurements', 
                    icon: '☀️',
                    features: ['Solar-optimized', 'Shade analysis', 'Panel layouts'],
                  },
                  { 
                    key: 'aurora_enabled',
                    name: 'Aurora Solar', 
                    description: 'Advanced solar design platform', 
                    icon: '🌟',
                    features: ['3D modeling', 'Shade reports', 'Production estimates'],
                  },
                ].map((provider) => (
                  <div key={provider.key} className="bg-white rounded-xl shadow-sm border p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center text-2xl">
                          {provider.icon}
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900">{provider.name}</h3>
                          <p className="text-sm text-gray-500">{provider.description}</p>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={measurementSettings[provider.key as keyof typeof measurementSettings] as boolean}
                          onChange={(e) => setMeasurementSettings(prev => ({ ...prev, [provider.key]: e.target.checked }))}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                      </label>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={async () => {
                    setSaving(true)
                    try {
                      const response = await fetch('/api/admin/settings', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          type: 'measurement_tools',
                          measure_tool_enabled: measurementSettings.measure_tool_enabled,
                          external_integrations: {
                            eagleview: measurementSettings.eagleview_enabled,
                            roofr: measurementSettings.roofr_enabled,
                            solo: measurementSettings.solo_enabled,
                            aurora: measurementSettings.aurora_enabled,
                          }
                        }),
                      })
                      
                      if (!response.ok) {
                        const data = await response.json()
                        alert(data.error || 'Failed to save settings')
                        return
                      }
                      
                      alert('Settings saved!')
                    } catch (error) {
                      console.error('Error saving settings:', error)
                      alert('Failed to save settings')
                    } finally {
                      setSaving(false)
                    }
                  }}
                  disabled={saving}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </div>
          )}

          {/* Canvass Dispositions */}
          {activeSection === 'canvass-dispositions' && (
            <div className="max-w-3xl">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Canvass Dispositions</h1>
                  <p className="text-gray-500 mt-1">Customize the disposition types your canvassers can use when knocking doors.</p>
                </div>
                <button
                  onClick={() => {
                    setEditingDisposition({
                      id: `dispo_${Date.now()}`,
                      label: '',
                      category: 'Contact',
                      color: '#3b82f6',
                      active: true,
                      sort_order: dispositions.length,
                    })
                    setShowAddDisposition(true)
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
                >
                  + Add Disposition
                </button>
              </div>

              {/* Categories */}
              <div className="mb-6 flex gap-2 flex-wrap">
                {['No Contact', 'Contact', 'Unqualified', 'Closed'].map((cat) => (
                  <span key={cat} className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm">
                    {cat}
                  </span>
                ))}
              </div>

              {/* Dispositions List */}
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Color</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Label</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {dispositions.sort((a, b) => a.sort_order - b.sort_order).map((dispo) => (
                      <tr key={dispo.id} className={!dispo.active ? 'bg-gray-50 opacity-60' : ''}>
                        <td className="px-4 py-3">
                          <div
                            className="w-8 h-8 rounded-full border-2 border-white shadow"
                            style={{ backgroundColor: dispo.color }}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-900">{dispo.label}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600">{dispo.category}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            dispo.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {dispo.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => {
                              setEditingDisposition(dispo)
                              setShowAddDisposition(true)
                            }}
                            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium mr-3"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              setDispositions(prev => prev.map(d => 
                                d.id === dispo.id ? { ...d, active: !d.active } : d
                              ))
                            }}
                            className="text-gray-500 hover:text-gray-700 text-sm"
                          >
                            {dispo.active ? 'Disable' : 'Enable'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Save Button */}
              <div className="mt-6 flex justify-end">
                <button
                  onClick={async () => {
                    setSaving(true)
                    try {
                      const response = await fetch('/api/admin/settings', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          type: 'canvass_dispositions',
                          dispositions: dispositions,
                        }),
                      })
                      
                      if (!response.ok) {
                        const data = await response.json()
                        alert(data.error || 'Failed to save dispositions')
                        return
                      }
                      
                      alert('Dispositions saved!')
                    } catch (error) {
                      console.error('Error saving dispositions:', error)
                      alert('Failed to save dispositions')
                    } finally {
                      setSaving(false)
                    }
                  }}
                  disabled={saving}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Dispositions'}
                </button>
              </div>

              {/* Edit/Add Modal */}
              {showAddDisposition && editingDisposition && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
                    <div className="p-6 border-b">
                      <h2 className="text-xl font-bold text-gray-900">
                        {dispositions.find(d => d.id === editingDisposition.id) ? 'Edit Disposition' : 'Add Disposition'}
                      </h2>
                    </div>
                    <div className="p-6 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Label *</label>
                        <input
                          type="text"
                          value={editingDisposition.label}
                          onChange={(e) => setEditingDisposition(prev => prev ? { ...prev, label: e.target.value } : null)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                          placeholder="e.g., Not Home, Hot Lead"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                        <select
                          value={editingDisposition.category}
                          onChange={(e) => setEditingDisposition(prev => prev ? { ...prev, category: e.target.value } : null)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                        >
                          <option value="No Contact">No Contact</option>
                          <option value="Contact">Contact</option>
                          <option value="Unqualified">Unqualified</option>
                          <option value="Closed">Closed</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
                        <div className="flex gap-2 flex-wrap">
                          {[
                            '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', 
                            '#8b5cf6', '#ec4899', '#6b7280', '#14b8a6', '#f43f5e'
                          ].map((color) => (
                            <button
                              key={color}
                              type="button"
                              onClick={() => setEditingDisposition(prev => prev ? { ...prev, color } : null)}
                              className={`w-10 h-10 rounded-full border-2 ${
                                editingDisposition.color === color ? 'border-gray-900 scale-110' : 'border-transparent'
                              }`}
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          id="dispo-active"
                          checked={editingDisposition.active}
                          onChange={(e) => setEditingDisposition(prev => prev ? { ...prev, active: e.target.checked } : null)}
                          className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                        />
                        <label htmlFor="dispo-active" className="text-sm text-gray-700">Active</label>
                      </div>
                    </div>
                    <div className="p-6 border-t flex justify-between">
                      {dispositions.find(d => d.id === editingDisposition.id) && (
                        <button
                          onClick={() => {
                            if (confirm('Delete this disposition?')) {
                              setDispositions(prev => prev.filter(d => d.id !== editingDisposition.id))
                              setShowAddDisposition(false)
                              setEditingDisposition(null)
                            }
                          }}
                          className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg"
                        >
                          Delete
                        </button>
                      )}
                      <div className="flex gap-3 ml-auto">
                        <button
                          onClick={() => {
                            setShowAddDisposition(false)
                            setEditingDisposition(null)
                          }}
                          className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            if (!editingDisposition.label) {
                              alert('Please enter a label')
                              return
                            }
                            const exists = dispositions.find(d => d.id === editingDisposition.id)
                            if (exists) {
                              setDispositions(prev => prev.map(d => 
                                d.id === editingDisposition.id ? editingDisposition : d
                              ))
                            } else {
                              setDispositions(prev => [...prev, editingDisposition])
                            }
                            setShowAddDisposition(false)
                            setEditingDisposition(null)
                          }}
                          className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Other Integrations */}
          {activeSection === 'integrations' && (
            <div className="max-w-2xl">
              <h1 className="text-2xl font-bold text-gray-900 mb-6">Other Integrations</h1>
              
              <div className="space-y-4">
                {[
                  { name: 'Xero', description: 'Accounting software', icon: '📊', connected: false },
                  { name: 'FreshBooks', description: 'Invoicing & accounting', icon: '📝', connected: false },
                  { name: 'Sage', description: 'Business management', icon: '📈', connected: false },
                  { name: 'Zapier', description: 'Connect to 5000+ apps', icon: '⚡', connected: false },
                  { name: 'Dropbox Sign', description: 'E-signatures', icon: '✍️', connected: true },
                  { name: 'Google Calendar', description: 'Calendar sync', icon: '📅', connected: false },
                  { name: 'Twilio', description: 'SMS notifications', icon: '📱', connected: false },
                  { name: 'SendGrid', description: 'Email delivery', icon: '📧', connected: false },
                ].map((integration) => (
                  <div key={integration.name} className="bg-white rounded-xl shadow-sm border p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center text-2xl">
                        {integration.icon}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{integration.name}</h3>
                        <p className="text-sm text-gray-500">{integration.description}</p>
                      </div>
                    </div>
                    <button
                      className={`px-4 py-2 rounded-lg font-medium text-sm ${
                        integration.connected
                          ? 'text-green-600 bg-green-50 border border-green-200'
                          : 'text-gray-600 border border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {integration.connected ? 'Connected' : 'Connect'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Commissions */}
          {activeSection === 'commissions' && (
            <div className="max-w-2xl">
              <h1 className="text-2xl font-bold text-gray-900 mb-6">Commission Settings</h1>
              
              {/* Period Settings */}
              <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Commission Period</h2>
                <p className="text-sm text-gray-500 mb-6">
                  Configure how commission periods are calculated for your team. This affects how commissions are grouped and displayed in reports and dashboards.
                </p>
                
                <div className="space-y-6">
                  {/* Period Type */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-3">Calculation Period</label>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { value: 'weekly', label: 'Weekly', desc: 'Reset every week' },
                        { value: 'bi-weekly', label: 'Bi-Weekly', desc: 'Reset every 2 weeks' },
                        { value: 'monthly', label: 'Monthly', desc: 'Reset every month' },
                      ].map((option) => (
                        <button
                          key={option.value}
                          onClick={() => setCommissionSettings(prev => ({ ...prev, commission_period: option.value as any }))}
                          className={`p-4 rounded-xl border-2 text-left transition-all ${
                            commissionSettings.commission_period === option.value
                              ? 'border-indigo-600 bg-indigo-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <p className={`font-medium ${commissionSettings.commission_period === option.value ? 'text-indigo-700' : 'text-gray-900'}`}>
                            {option.label}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">{option.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Week Start Day */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Week Starts On</label>
                    <select
                      value={commissionSettings.week_start_day}
                      onChange={(e) => setCommissionSettings(prev => ({ ...prev, week_start_day: parseInt(e.target.value) }))}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white"
                    >
                      <option value={0}>Sunday</option>
                      <option value={1}>Monday</option>
                      <option value={2}>Tuesday</option>
                      <option value={3}>Wednesday</option>
                      <option value={4}>Thursday</option>
                      <option value={5}>Friday</option>
                      <option value={6}>Saturday</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      This determines when weekly and bi-weekly periods start
                    </p>
                  </div>

                  {/* Bi-weekly reference date */}
                  {commissionSettings.commission_period === 'bi-weekly' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Bi-Weekly Reference Date</label>
                      <input
                        type="date"
                        value={commissionSettings.bi_weekly_start_date}
                        onChange={(e) => setCommissionSettings(prev => ({ ...prev, bi_weekly_start_date: e.target.value }))}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Pick a date that marks the start of a bi-weekly period (e.g., your last pay period start date)
                      </p>
                    </div>
                  )}
                </div>

                {/* Preview */}
                <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Current Period Preview</h3>
                  <p className="text-sm text-gray-600">
                    {commissionSettings.commission_period === 'weekly' && (
                      <>Commissions will be calculated from {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][commissionSettings.week_start_day]} to {['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][commissionSettings.week_start_day]}.</>
                    )}
                    {commissionSettings.commission_period === 'bi-weekly' && (
                      <>Commissions will be calculated in 2-week periods starting on {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][commissionSettings.week_start_day]}s.</>
                    )}
                    {commissionSettings.commission_period === 'monthly' && (
                      <>Commissions will be calculated from the 1st to the last day of each month.</>
                    )}
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t">
                  <button
                    onClick={async () => {
                      setSaving(true)
                      try {
                        const response = await fetch('/api/admin/settings', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            type: 'commission',
                            commission: commissionSettings,
                          }),
                        })
                        
                        if (!response.ok) {
                          const data = await response.json()
                          alert(data.error || 'Failed to save commission settings')
                          return
                        }
                        
                        alert('Commission settings saved!')
                      } catch (error) {
                        console.error('Error saving commission settings:', error)
                        alert('Failed to save commission settings')
                      } finally {
                        setSaving(false)
                      }
                    }}
                    disabled={saving}
                    className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Commission Settings'}
                  </button>
                </div>
              </div>

              {/* Link to Comp Plans */}
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-2">Compensation Plans</h2>
                <p className="text-gray-600 mb-4">
                  Manage compensation plans and commission structures for your team.
                </p>
                <a
                  href="/admin/comp-plans"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  Go to Comp Plans
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              </div>
            </div>
          )}

          {/* Contact Fields */}
          {activeSection === 'contact-fields' && (
            <div className="max-w-3xl">
              <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Contact Fields</h1>
                <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium">
                  + Add Field
                </button>
              </div>
              
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Field Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Required</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {[
                      { name: 'First Name', type: 'text', required: true, system: true },
                      { name: 'Last Name', type: 'text', required: true, system: true },
                      { name: 'Email', type: 'text', required: false, system: true },
                      { name: 'Phone', type: 'text', required: false, system: true },
                      { name: 'Address', type: 'text', required: false, system: true },
                      { name: 'Lead Source', type: 'select', required: false, system: false },
                      { name: 'Preferred Contact Method', type: 'select', required: false, system: false },
                    ].map((field, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-900">{field.name}</span>
                          {field.system && <span className="ml-2 text-xs text-gray-400">(System)</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-sm capitalize">{field.type}</td>
                        <td className="px-4 py-3">
                          {field.required ? (
                            <span className="text-green-600">Yes</span>
                          ) : (
                            <span className="text-gray-400">No</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {!field.system && (
                            <button className="text-indigo-600 hover:text-indigo-800 text-sm">Edit</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Contact Workflows */}
          {activeSection === 'contact-workflows' && (
            <div className="max-w-3xl">
              <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Contact Workflows</h1>
                <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium">
                  + Add Stage
                </button>
              </div>
              
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <p className="text-sm text-gray-500 mb-4">
                  Define the stages a contact goes through in your sales process.
                </p>
                <div className="space-y-2">
                  {[
                    { name: 'New', color: '#6366f1' },
                    { name: 'Contacted', color: '#3b82f6' },
                    { name: 'Qualified', color: '#22c55e' },
                    { name: 'Proposal Sent', color: '#f59e0b' },
                    { name: 'Won', color: '#10b981' },
                    { name: 'Lost', color: '#ef4444' },
                  ].map((stage, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                      <div className="w-4 h-4 rounded" style={{ backgroundColor: stage.color }} />
                      <span className="font-medium text-gray-900 flex-1">{stage.name}</span>
                      <button className="text-gray-400 hover:text-gray-600">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Job/Project Fields */}
          {activeSection === 'job-fields' && (
            <div className="max-w-3xl">
              <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Project Fields</h1>
                <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium">
                  + Add Field
                </button>
              </div>
              
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Field Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Required</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {[
                      { name: 'Project Type', type: 'select', required: true, system: true },
                      { name: 'Address', type: 'text', required: true, system: true },
                      { name: 'Contract Value', type: 'number', required: false, system: true },
                      { name: 'Start Date', type: 'date', required: false, system: true },
                      { name: 'Roof Type', type: 'select', required: false, system: false },
                      { name: 'Square Footage', type: 'number', required: false, system: false },
                      { name: 'Insurance Claim #', type: 'text', required: false, system: false },
                    ].map((field, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-900">{field.name}</span>
                          {field.system && <span className="ml-2 text-xs text-gray-400">(System)</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-sm capitalize">{field.type}</td>
                        <td className="px-4 py-3">
                          {field.required ? (
                            <span className="text-green-600">Yes</span>
                          ) : (
                            <span className="text-gray-400">No</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {!field.system && (
                            <button className="text-indigo-600 hover:text-indigo-800 text-sm">Edit</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Job/Project Workflows */}
          {activeSection === 'job-workflows' && (
            <div className="max-w-3xl">
              <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Project Workflows</h1>
                <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium">
                  + Add Stage
                </button>
              </div>
              
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <p className="text-sm text-gray-500 mb-4">
                  Define the stages a project goes through from sale to completion.
                </p>
                <div className="space-y-2">
                  {[
                    { name: 'Open', color: '#6366f1' },
                    { name: 'In Progress', color: '#3b82f6' },
                    { name: 'Materials Ordered', color: '#8b5cf6' },
                    { name: 'Scheduled', color: '#f59e0b' },
                    { name: 'In Production', color: '#22c55e' },
                    { name: 'Complete', color: '#10b981' },
                    { name: 'Collected', color: '#059669' },
                    { name: 'On Hold', color: '#ef4444' },
                  ].map((stage, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                      <div className="w-4 h-4 rounded" style={{ backgroundColor: stage.color }} />
                      <span className="font-medium text-gray-900 flex-1">{stage.name}</span>
                      <button className="text-gray-400 hover:text-gray-600">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Work Order Fields */}
          {activeSection === 'work-order-fields' && (
            <div className="max-w-3xl">
              <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Work Order Fields</h1>
                <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium">
                  + Add Field
                </button>
              </div>
              
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <p className="text-gray-500">Configure custom fields for work orders and crew assignments.</p>
              </div>
            </div>
          )}

          {/* Work Order Workflows */}
          {activeSection === 'work-order-workflows' && (
            <div className="max-w-3xl">
              <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Work Order Workflows</h1>
                <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium">
                  + Add Stage
                </button>
              </div>
              
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <p className="text-gray-500">Define workflow stages for work orders.</p>
              </div>
            </div>
          )}

          {/* Budgets */}
          {activeSection === 'budgets' && (
            <div className="max-w-3xl">
              <h1 className="text-2xl font-bold text-gray-900 mb-6">Budgets</h1>
              
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <p className="text-gray-500 mb-4">Set up budget tracking and cost management.</p>
                <div className="p-4 bg-amber-50 rounded-lg border border-amber-100">
                  <p className="text-sm text-amber-700">Budget tracking coming soon. This will allow you to set monthly/quarterly targets and track actual vs. projected revenue.</p>
                </div>
              </div>
            </div>
          )}

          {/* Capital */}
          {activeSection === 'capital' && (
            <div className="max-w-3xl">
              <h1 className="text-2xl font-bold text-gray-900 mb-6">Capital</h1>
              
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <p className="text-gray-500 mb-4">Manage capital expenditures and financing.</p>
                <div className="p-4 bg-amber-50 rounded-lg border border-amber-100">
                  <p className="text-sm text-amber-700">Capital management coming soon. Track equipment purchases, financing, and depreciation.</p>
                </div>
              </div>
            </div>
          )}

          {/* Notifications */}
          {activeSection === 'notifications' && (
            <div className="max-w-3xl">
              <h1 className="text-2xl font-bold text-gray-900 mb-6">Notification Templates</h1>
              
              <div className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
                <p className="text-gray-500">Configure email and SMS notification templates.</p>
                
                {[
                  { name: 'Appointment Reminder', type: 'SMS + Email', active: true },
                  { name: 'Inspection Scheduled', type: 'Email', active: true },
                  { name: 'Contract Ready', type: 'Email', active: true },
                  { name: 'Project Complete', type: 'SMS + Email', active: false },
                  { name: 'Payment Received', type: 'Email', active: true },
                ].map((template, idx) => (
                  <div key={idx} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div>
                      <h3 className="font-medium text-gray-900">{template.name}</h3>
                      <p className="text-sm text-gray-500">{template.type}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-1 text-xs rounded-full ${template.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {template.active ? 'Active' : 'Inactive'}
                      </span>
                      <button className="text-indigo-600 hover:text-indigo-800 text-sm">Edit</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
