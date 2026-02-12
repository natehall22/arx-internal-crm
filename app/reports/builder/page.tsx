'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Nav from '@/components/Nav'
import { createClientBrowser } from '@/lib/supabase/client'
import type { ReportType, ReportDataSource, CustomReport } from '@/lib/types/database'

const reportTypes: { id: ReportType; label: string; icon: string; description: string }[] = [
  { id: 'metric_card', label: 'Metric Card', icon: '📊', description: 'Single number with comparison' },
  { id: 'bar_chart', label: 'Bar Chart', icon: '📊', description: 'Compare values across categories' },
  { id: 'line_chart', label: 'Line Chart', icon: '📈', description: 'Show trends over time' },
  { id: 'pie_chart', label: 'Pie Chart', icon: '🥧', description: 'Show proportions of a whole' },
  { id: 'table', label: 'Data Table', icon: '📋', description: 'Detailed data rows' },
  { id: 'funnel', label: 'Funnel', icon: '🔻', description: 'Show conversion stages' },
]

// Extended data source type to include canvass_activity
type ExtendedDataSource = ReportDataSource | 'canvass_activity'

const dataSources: { id: ExtendedDataSource; label: string; columns: { id: string; label: string; type: string }[] }[] = [
  { 
    id: 'canvass_activity', 
    label: 'Canvass Activity (Doors Knocked)',
    columns: [
      { id: 'count', label: 'Count', type: 'number' },
      { id: 'canvass_disposition', label: 'Disposition', type: 'string' },
      { id: 'owner_user_id', label: 'Rep', type: 'user' },
      { id: 'created_at', label: 'Date', type: 'date' },
    ]
  },
  { 
    id: 'leads', 
    label: 'All Leads',
    columns: [
      { id: 'count', label: 'Count', type: 'number' },
      { id: 'status', label: 'Status', type: 'string' },
      { id: 'canvass_disposition', label: 'Disposition', type: 'string' },
      { id: 'created_at', label: 'Created Date', type: 'date' },
      { id: 'owner_user_id', label: 'Owner', type: 'user' },
    ]
  },
  { 
    id: 'opportunities', 
    label: 'Opportunities',
    columns: [
      { id: 'count', label: 'Count', type: 'number' },
      { id: 'status', label: 'Status', type: 'string' },
      { id: 'inspection_outcome', label: 'Inspection Outcome', type: 'string' },
      { id: 'estimated_value', label: 'Estimated Value', type: 'currency' },
      { id: 'created_at', label: 'Created Date', type: 'date' },
      { id: 'owner_user_id', label: 'Owner', type: 'user' },
    ]
  },
  { 
    id: 'projects', 
    label: 'Projects',
    columns: [
      { id: 'count', label: 'Count', type: 'number' },
      { id: 'status', label: 'Status', type: 'string' },
      { id: 'total_price', label: 'Total Price', type: 'currency' },
      { id: 'created_at', label: 'Created Date', type: 'date' },
      { id: 'owner_user_id', label: 'Owner', type: 'user' },
    ]
  },
  { 
    id: 'appointments', 
    label: 'Appointments',
    columns: [
      { id: 'count', label: 'Count', type: 'number' },
      { id: 'status', label: 'Status', type: 'string' },
      { id: 'scheduled_for', label: 'Scheduled Date', type: 'date' },
      { id: 'closer_user_id', label: 'Closer', type: 'user' },
      { id: 'canvasser_user_id', label: 'Setter', type: 'user' },
    ]
  },
  { 
    id: 'inspection_outcomes', 
    label: 'Inspection Outcomes',
    columns: [
      { id: 'count', label: 'Count', type: 'number' },
      { id: 'outcome', label: 'Outcome', type: 'string' },
      { id: 'completed_at', label: 'Completed Date', type: 'date' },
      { id: 'closer_user_id', label: 'Closer', type: 'user' },
      { id: 'setter_user_id', label: 'Setter', type: 'user' },
    ]
  },
]

const dateRangeOptions = [
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom range' },
]

const aggregationOptions = [
  { id: 'count', label: 'Count' },
  { id: 'sum', label: 'Sum' },
  { id: 'avg', label: 'Average' },
  { id: 'min', label: 'Minimum' },
  { id: 'max', label: 'Maximum' },
]

export default function ReportBuilderPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editId = searchParams.get('edit')
  
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [users, setUsers] = useState<any[]>([])
  const [roles, setRoles] = useState<any[]>([])
  const [step, setStep] = useState(1)
  
  // Report configuration
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [reportType, setReportType] = useState<ReportType>('bar_chart')
  const [dataSource, setDataSource] = useState<ExtendedDataSource>('leads')
  const [groupBy, setGroupBy] = useState('')
  const [aggregation, setAggregation] = useState('count')
  const [valueColumn, setValueColumn] = useState('')
  const [dateRange, setDateRange] = useState('30d')
  const [isPublic, setIsPublic] = useState(false)
  const [isDashboardWidget, setIsDashboardWidget] = useState(false)
  const [roleAccess, setRoleAccess] = useState<Record<string, boolean>>({})

  const supabase = createClientBrowser()

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (editId) {
      loadReport(editId)
    }
  }, [editId])

  const loadData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()

    setCurrentUser(profile)

    // Load users for filters
    const { data: usersData } = await supabase
      .from('users')
      .select('id, full_name, role')
      .eq('org_id', profile?.org_id)

    setUsers(usersData || [])

    // Load roles
    const { data: rolesData } = await supabase
      .from('custom_roles')
      .select('*')
      .eq('org_id', profile?.org_id)

    setRoles(rolesData || [])

    // Initialize role access with legacy roles
    const initialAccess: Record<string, boolean> = {
      admin: true,
      regional_manager: true,
      sales_manager: true,
      sales_rep: false,
      canvasser: false,
      operations: false,
    }
    setRoleAccess(initialAccess)
  }

  const loadReport = async (id: string) => {
    setLoading(true)
    const { data: report } = await supabase
      .from('custom_reports')
      .select('*, report_role_access(*)')
      .eq('id', id)
      .single()

    if (report) {
      setName(report.name)
      setDescription(report.description || '')
      setReportType(report.report_type)
      setDataSource(report.data_source)
      setGroupBy(report.config?.groupBy || '')
      setAggregation(report.config?.aggregation || 'count')
      setValueColumn(report.config?.valueColumn || '')
      setDateRange(report.config?.dateRange || '30d')
      setIsPublic(report.is_public)
      setIsDashboardWidget(report.is_dashboard_widget)

      // Load role access
      const access: Record<string, boolean> = {}
      report.report_role_access?.forEach((ra: any) => {
        access[ra.role] = ra.can_view
      })
      setRoleAccess(access)
    }
    setLoading(false)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      alert('Please enter a report name')
      return
    }

    if (!currentUser?.org_id) {
      alert('Unable to save report: User profile not loaded. Please refresh the page and try again.')
      return
    }

    setSaving(true)

    try {
      const config = {
        groupBy,
        aggregation,
        valueColumn,
        dateRange,
      }

      if (editId) {
        // Update existing report
        // Map canvass_activity to leads for storage (it's a filtered view of leads)
        const storedDataSource = dataSource === 'canvass_activity' ? 'leads' : dataSource
        const storedConfig = dataSource === 'canvass_activity' 
          ? { ...config, isCanvassActivity: true }
          : config

        await supabase
          .from('custom_reports')
          .update({
            name,
            description,
            report_type: reportType,
            data_source: storedDataSource,
            config: storedConfig,
            is_public: isPublic,
            is_dashboard_widget: isDashboardWidget,
          })
          .eq('id', editId)

        // Update role access
        await supabase
          .from('report_role_access')
          .delete()
          .eq('report_id', editId)

        const accessRecords = Object.entries(roleAccess)
          .filter(([_, canView]) => canView)
          .map(([role]) => ({
            report_id: editId,
            role,
            can_view: true,
            can_edit: role === 'admin',
          }))

        if (accessRecords.length > 0) {
          await supabase
            .from('report_role_access')
            .insert(accessRecords)
        }
      } else {
        // Create new report
        // Map canvass_activity to leads for storage (it's a filtered view of leads)
        const storedDataSource = dataSource === 'canvass_activity' ? 'leads' : dataSource
        const storedConfig = dataSource === 'canvass_activity' 
          ? { ...config, isCanvassActivity: true }
          : config

        const { data: newReport, error } = await supabase
          .from('custom_reports')
          .insert({
            org_id: currentUser.org_id,
            created_by: currentUser.id,
            name,
            description,
            report_type: reportType,
            data_source: storedDataSource,
            config: storedConfig,
            is_public: isPublic,
            is_dashboard_widget: isDashboardWidget,
          })
          .select()
          .single()

        if (error) throw error

        // Add role access
        const accessRecords = Object.entries(roleAccess)
          .filter(([_, canView]) => canView)
          .map(([role]) => ({
            report_id: newReport.id,
            role,
            can_view: true,
            can_edit: role === 'admin',
          }))

        if (accessRecords.length > 0) {
          await supabase
            .from('report_role_access')
            .insert(accessRecords)
        }
      }

      router.push('/reports')
    } catch (error: any) {
      console.error('Error saving report:', error)
      const errorMessage = error?.message || error?.error_description || 'Unknown error'
      if (errorMessage.includes('custom_reports') || errorMessage.includes('relation')) {
        alert('Failed to save report: The reports table has not been set up. Please ask your admin to run the database migration.')
      } else {
        alert(`Failed to save report: ${errorMessage}`)
      }
    } finally {
      setSaving(false)
    }
  }

  const selectedDataSource = dataSources.find(ds => ds.id === dataSource)
  const groupByOptions = selectedDataSource?.columns.filter(c => c.type === 'string' || c.type === 'user') || []
  const valueOptions = selectedDataSource?.columns.filter(c => c.type === 'number' || c.type === 'currency') || []

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">
            {editId ? 'Edit Report' : 'Create Custom Report'}
          </h1>
          <p className="text-gray-500 mt-1">
            Build a custom report to track the metrics that matter to you
          </p>
        </div>

        {/* Progress steps */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex items-center">
              <button
                onClick={() => setStep(s)}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step === s
                    ? 'bg-indigo-600 text-white'
                    : step > s
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                {step > s ? '✓' : s}
              </button>
              {s < 4 && <div className={`w-12 h-1 ${step > s ? 'bg-green-500' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        {/* Step 1: Basic Info */}
        {step === 1 && (
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-6">
            <h2 className="text-lg font-semibold text-gray-900">Basic Information</h2>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Report Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Weekly Close Rate by Rep"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this report show?"
                rows={2}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Report Type
              </label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {reportTypes.map((type) => (
                  <button
                    key={type.id}
                    onClick={() => setReportType(type.id)}
                    className={`p-4 rounded-lg border-2 text-left transition-colors ${
                      reportType === type.id
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <span className="text-2xl">{type.icon}</span>
                    <p className="font-medium text-gray-900 mt-2">{type.label}</p>
                    <p className="text-xs text-gray-500 mt-1">{type.description}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setStep(2)}
                disabled={!name.trim()}
                className="px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                Next: Data Source
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Data Source */}
        {step === 2 && (
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-6">
            <h2 className="text-lg font-semibold text-gray-900">Data Source & Configuration</h2>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Data Source
              </label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {dataSources.map((ds) => (
                  <button
                    key={ds.id}
                    onClick={() => {
                      setDataSource(ds.id)
                      setGroupBy('')
                      setValueColumn('')
                    }}
                    className={`p-4 rounded-lg border-2 text-left transition-colors ${
                      dataSource === ds.id
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="font-medium text-gray-900">{ds.label}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {ds.columns.length} fields available
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Group By
              </label>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white"
              >
                <option value="">No grouping</option>
                {groupByOptions.map((col) => (
                  <option key={col.id} value={col.id}>{col.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Aggregation
                </label>
                <select
                  value={aggregation}
                  onChange={(e) => setAggregation(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white"
                >
                  {aggregationOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
              </div>
              {aggregation !== 'count' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Value Column
                  </label>
                  <select
                    value={valueColumn}
                    onChange={(e) => setValueColumn(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white"
                  >
                    <option value="">Select column</option>
                    {valueOptions.map((col) => (
                      <option key={col.id} value={col.id}>{col.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Date Range
              </label>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white"
              >
                {dateRangeOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep(1)}
                className="px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                className="px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700"
              >
                Next: Visibility
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Visibility & Permissions */}
        {step === 3 && (
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-6">
            <h2 className="text-lg font-semibold text-gray-900">Visibility & Permissions</h2>
            
            <div className="space-y-4">
              <label className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="w-5 h-5 rounded border-gray-300 text-indigo-600"
                />
                <div>
                  <p className="font-medium text-gray-900">Public Report</p>
                  <p className="text-sm text-gray-500">Anyone in your organization can view this report</p>
                </div>
              </label>

              <label className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={isDashboardWidget}
                  onChange={(e) => setIsDashboardWidget(e.target.checked)}
                  className="w-5 h-5 rounded border-gray-300 text-indigo-600"
                />
                <div>
                  <p className="font-medium text-gray-900">Show on Dashboard</p>
                  <p className="text-sm text-gray-500">Display this report as a widget on the dashboard</p>
                </div>
              </label>
            </div>

            {!isPublic && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Role Access
                </label>
                <p className="text-sm text-gray-500 mb-4">
                  Select which roles can view this report
                </p>
                <div className="space-y-2">
                  {['admin', 'regional_manager', 'sales_manager', 'sales_rep', 'canvasser', 'operations'].map((role) => (
                    <label
                      key={role}
                      className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={roleAccess[role] || false}
                        onChange={(e) => setRoleAccess(prev => ({ ...prev, [role]: e.target.checked }))}
                        className="w-5 h-5 rounded border-gray-300 text-indigo-600"
                        disabled={role === 'admin'}
                      />
                      <span className="font-medium text-gray-900 capitalize">
                        {role.replace('_', ' ')}
                      </span>
                      {role === 'admin' && (
                        <span className="text-xs text-gray-500">(always has access)</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-between">
              <button
                onClick={() => setStep(2)}
                className="px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={() => setStep(4)}
                className="px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700"
              >
                Next: Preview
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Preview & Save */}
        {step === 4 && (
          <div className="bg-white rounded-xl shadow-sm p-6 space-y-6">
            <h2 className="text-lg font-semibold text-gray-900">Review & Save</h2>
            
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-500">Name</span>
                <span className="font-medium text-gray-900">{name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Type</span>
                <span className="font-medium text-gray-900">
                  {reportTypes.find(t => t.id === reportType)?.label}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Data Source</span>
                <span className="font-medium text-gray-900">
                  {dataSources.find(ds => ds.id === dataSource)?.label}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Group By</span>
                <span className="font-medium text-gray-900">
                  {groupBy ? groupByOptions.find(c => c.id === groupBy)?.label : 'None'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Aggregation</span>
                <span className="font-medium text-gray-900 capitalize">{aggregation}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Date Range</span>
                <span className="font-medium text-gray-900">
                  {dateRangeOptions.find(d => d.id === dateRange)?.label}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Visibility</span>
                <span className="font-medium text-gray-900">
                  {isPublic ? 'Public' : 'Role-based'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Dashboard Widget</span>
                <span className="font-medium text-gray-900">
                  {isDashboardWidget ? 'Yes' : 'No'}
                </span>
              </div>
            </div>

            {/* Preview placeholder */}
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
              <p className="text-gray-500">Report preview will appear here after saving</p>
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setStep(3)}
                className="px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-8 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : editId ? 'Update Report' : 'Create Report'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
