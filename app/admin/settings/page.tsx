'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Nav from '@/components/Nav'
import Image from 'next/image'

type SettingsSection = 
  | 'contact-fields' 
  | 'job-fields' 
  | 'job-workflows'
  | 'work-order-fields'
  | 'work-order-workflows'
  | 'canvass-dispositions'
  | 'inspection-outcomes'
  | 'estimate-settings'
  | 'appointment-settings'
  | 'budgets'
  | 'capital'
  | 'commissions'
  | 'quickbooks'
  | 'integrations'
  | 'measurement-tools'
  | 'notifications'
  | 'reports'
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

interface InspectionOutcomeType {
  id: string
  label: string
  description: string
  color: string
  icon: string
  active: boolean
  converts_to_opportunity: boolean
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

interface WorkOrderField {
  id: string
  name: string
  field_type: 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea'
  options?: string[]
  required: boolean
  applies_to: 'work_order' | 'crew_assignment' | 'both'
  sort_order: number
  active: boolean
}

interface WorkOrderWorkflowStage {
  id: string
  name: string
  color: string
  sort_order: number
  is_default?: boolean
  is_complete_stage?: boolean
  notify_customer?: boolean
  auto_actions?: string[]
}

export default function AdminSettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const [saving, setSaving] = useState(false)
  
  // Settings state
  const [customFields, setCustomFields] = useState<CustomField[]>([])
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
  const [reportSettings, setReportSettings] = useState({
    include_admins_in_reports: true, // Default: admins show in reports
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
  
  // Inspection Outcomes
  const [inspectionOutcomes, setInspectionOutcomes] = useState<InspectionOutcomeType[]>([
    { id: 'sale', label: 'Sale', description: 'Customer signed the contract', color: '#22c55e', icon: '✓', active: true, converts_to_opportunity: true, sort_order: 0 },
    { id: 'moving_to_close', label: 'Moving to Close', description: 'Customer interested, following up to close', color: '#10b981', icon: '→', active: true, converts_to_opportunity: true, sort_order: 1 },
    { id: 'insurance_follow_up', label: 'Insurance Follow Up', description: 'Waiting on insurance claim/approval', color: '#8b5cf6', icon: '📋', active: true, converts_to_opportunity: true, sort_order: 2 },
    { id: 'said_no', label: 'Said No', description: 'Customer declined after presentation', color: '#ef4444', icon: '✗', active: true, converts_to_opportunity: false, sort_order: 3 },
    { id: 'not_home', label: 'Not Home', description: 'Customer was not present', color: '#f59e0b', icon: '?', active: true, converts_to_opportunity: false, sort_order: 4 },
    { id: 'no_problems_found', label: 'No Problems Found', description: 'Roof inspection showed no issues', color: '#6b7280', icon: '○', active: true, converts_to_opportunity: false, sort_order: 5 },
    { id: 'failed_credit', label: 'Failed Credit', description: 'Customer did not qualify for financing', color: '#f97316', icon: '$', active: true, converts_to_opportunity: true, sort_order: 6 },
    { id: 'rescheduled', label: 'Rescheduled', description: 'Appointment moved to new date', color: '#3b82f6', icon: '↻', active: true, converts_to_opportunity: false, sort_order: 7 },
  ])
  const [editingInspectionOutcome, setEditingInspectionOutcome] = useState<InspectionOutcomeType | null>(null)
  const [showAddInspectionOutcome, setShowAddInspectionOutcome] = useState(false)
  
  // Appointment types
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([
    { id: 'inspection', name: 'Inspection', duration_minutes: 60, color: '#3b82f6', active: true, description: 'Standard roof inspection' },
    { id: 'follow_up', name: 'Follow Up', duration_minutes: 30, color: '#22c55e', active: true, description: 'Follow up visit' },
    { id: 'contract_signing', name: 'Contract Signing', duration_minutes: 45, color: '#8b5cf6', active: true, description: 'Contract signing appointment' },
    { id: 'final_walkthrough', name: 'Final Walkthrough', duration_minutes: 30, color: '#f59e0b', active: true, description: 'Post-installation walkthrough' },
  ])
  const [editingAppointmentType, setEditingAppointmentType] = useState<AppointmentType | null>(null)
  const [showAddAppointmentType, setShowAddAppointmentType] = useState(false)
  
  // Work Order Fields state
  const [workOrderFields, setWorkOrderFields] = useState<WorkOrderField[]>([
    { id: 'wo_notes', name: 'Special Instructions', field_type: 'textarea', required: false, applies_to: 'work_order', sort_order: 0, active: true },
    { id: 'wo_access_code', name: 'Gate/Access Code', field_type: 'text', required: false, applies_to: 'work_order', sort_order: 1, active: true },
    { id: 'wo_permit_number', name: 'Permit Number', field_type: 'text', required: false, applies_to: 'work_order', sort_order: 2, active: true },
    { id: 'crew_lead', name: 'Crew Lead', field_type: 'text', required: false, applies_to: 'crew_assignment', sort_order: 3, active: true },
    { id: 'crew_size', name: 'Crew Size', field_type: 'number', required: false, applies_to: 'crew_assignment', sort_order: 4, active: true },
  ])
  const [editingWorkOrderField, setEditingWorkOrderField] = useState<WorkOrderField | null>(null)
  const [showAddWorkOrderField, setShowAddWorkOrderField] = useState(false)
  
  // Work Order Workflow Stages state
  const [workOrderStages, setWorkOrderStages] = useState<WorkOrderWorkflowStage[]>([
    { id: 'pending', name: 'Pending', color: '#6b7280', sort_order: 0, is_default: true },
    { id: 'scheduled', name: 'Scheduled', color: '#3b82f6', sort_order: 1, notify_customer: true },
    { id: 'in_progress', name: 'In Progress', color: '#f59e0b', sort_order: 2 },
    { id: 'on_hold', name: 'On Hold', color: '#ef4444', sort_order: 3 },
    { id: 'completed', name: 'Completed', color: '#22c55e', sort_order: 4, is_complete_stage: true, notify_customer: true },
    { id: 'cancelled', name: 'Cancelled', color: '#9ca3af', sort_order: 5 },
  ])
  const [editingWorkOrderStage, setEditingWorkOrderStage] = useState<WorkOrderWorkflowStage | null>(null)
  const [showAddWorkOrderStage, setShowAddWorkOrderStage] = useState(false)
  
  // Logo state
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [userRole, setUserRole] = useState<string>('')
  const logoInputRef = useRef<HTMLInputElement>(null)
  
  // External integrations state - organized by category with clear use cases
  interface IntegrationConfig {
    account?: string
    api_key?: string
    webhook_url?: string
    [key: string]: string | undefined
  }
  interface ExternalIntegration {
    id: string
    name: string
    category: 'signatures' | 'measurements' | 'accounting' | 'communication' | 'automation'
    description: string
    useCases: string[]
    icon: string
    connected: boolean
    enabled: boolean
    config?: IntegrationConfig
    configFields: { key: string; label: string; type: 'text' | 'password' | 'email'; placeholder: string; required: boolean }[]
  }
  
  const defaultIntegrations: ExternalIntegration[] = [
    // E-SIGNATURES
    {
      id: 'dropbox_sign',
      name: 'Dropbox Sign',
      category: 'signatures',
      description: 'Send contracts and change orders for e-signature',
      useCases: [
        'Send contracts from Opportunity page',
        'Get signed proposals from Proposal Builder',
        'Send change orders from Work Orders / Jobs',
        'Track signature status on deals',
      ],
      icon: '✍️',
      connected: false,
      enabled: true,
      configFields: [
        { key: 'account', label: 'Account Email', type: 'email', placeholder: 'your-email@company.com', required: true },
        { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'From Dropbox Sign Dashboard → API', required: true },
      ],
    },
    {
      id: 'docusign',
      name: 'DocuSign',
      category: 'signatures',
      description: 'Enterprise e-signature solution for contracts and change orders',
      useCases: [
        'Send contracts from Opportunity page',
        'Get signed proposals from Proposal Builder',
        'Send change orders from Work Orders / Jobs',
        'Automated document workflows',
      ],
      icon: '📝',
      connected: false,
      enabled: true,
      configFields: [
        { key: 'account', label: 'Account Email', type: 'email', placeholder: 'your-email@company.com', required: true },
        { key: 'api_key', label: 'Integration Key', type: 'password', placeholder: 'From DocuSign Admin → Integrations', required: true },
      ],
    },
    {
      id: 'signnow',
      name: 'signNow',
      category: 'signatures',
      description: 'Fast, affordable e-signatures for contracts and documents',
      useCases: [
        'Send contracts from Opportunity page',
        'Get signed proposals from Proposal Builder',
        'Send change orders from Work Orders / Jobs',
        'In-person signing on tablet/phone',
      ],
      icon: '✒️',
      connected: false,
      enabled: true,
      configFields: [
        { key: 'account', label: 'Account Email', type: 'email', placeholder: 'your-email@company.com', required: true },
        { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'From signNow Settings → API', required: true },
      ],
    },
    // PDF & DOCUMENT MANAGEMENT
    {
      id: 'pdf_upload',
      name: 'PDF Documents',
      category: 'signatures',
      description: 'Upload and send PDF contracts, agreements, and documents',
      useCases: [
        'Upload custom PDF contracts',
        'Send PDFs for signature via email',
        'Attach signed documents to opportunities',
        'Store completed documents with jobs',
      ],
      icon: '📄',
      connected: false,
      enabled: true,
      configFields: [
        { key: 'storage_provider', label: 'Storage', type: 'text', placeholder: 'Default: Built-in storage', required: false },
      ],
    },
    // MEASUREMENTS & DESIGN
    {
      id: 'eagleview',
      name: 'EagleView',
      category: 'measurements',
      description: 'Aerial roof measurements and 3D property data',
      useCases: [
        'Order measurements from Proposal Builder',
        'Auto-import roof data into estimates',
        'Access 3D models for design',
      ],
      icon: '🦅',
      connected: false,
      enabled: true,
      configFields: [
        { key: 'account', label: 'EagleView Username', type: 'text', placeholder: 'Your EagleView login', required: true },
        { key: 'api_key', label: 'API Token', type: 'password', placeholder: 'From EagleView Account Settings', required: true },
      ],
    },
    {
      id: 'hover',
      name: 'HOVER',
      category: 'measurements',
      description: 'Smartphone-based 3D property models and measurements',
      useCases: [
        'Create 3D models from phone photos',
        'Import measurements to proposals',
        'Visualize material options',
      ],
      icon: '📱',
      connected: false,
      enabled: true,
      configFields: [
        { key: 'account', label: 'HOVER Email', type: 'email', placeholder: 'your-email@company.com', required: true },
        { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'From HOVER Dashboard', required: true },
      ],
    },
    {
      id: 'roofr',
      name: 'Roofr',
      category: 'measurements',
      description: 'Instant satellite roof measurements',
      useCases: [
        'Quick measurements from address',
        'Import to Proposal Builder',
        'Instant quotes for customers',
      ],
      icon: '🏠',
      connected: false,
      enabled: true,
      configFields: [
        { key: 'account', label: 'Roofr Email', type: 'email', placeholder: 'your-email@company.com', required: true },
        { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'From Roofr Settings', required: true },
      ],
    },
    // ACCOUNTING
    {
      id: 'quickbooks',
      name: 'QuickBooks',
      category: 'accounting',
      description: 'Sync invoices, payments, and customer data',
      useCases: [
        'Auto-create invoices from won deals',
        'Sync customer records',
        'Track payments in one place',
      ],
      icon: '💰',
      connected: false,
      enabled: true,
      configFields: [
        { key: 'account', label: 'QuickBooks Company', type: 'text', placeholder: 'Your company name', required: true },
      ],
    },
    {
      id: 'xero',
      name: 'Xero',
      category: 'accounting',
      description: 'Cloud accounting for invoicing and financials',
      useCases: [
        'Generate invoices from opportunities',
        'Sync customer and payment data',
        'Financial reporting',
      ],
      icon: '📊',
      connected: false,
      enabled: true,
      configFields: [
        { key: 'account', label: 'Xero Organization', type: 'text', placeholder: 'Your organization name', required: true },
      ],
    },
    // COMMUNICATION
    {
      id: 'twilio',
      name: 'Twilio',
      category: 'communication',
      description: 'SMS notifications to customers and team',
      useCases: [
        'Appointment reminders to homeowners',
        'Job status updates via text',
        'Team notifications',
      ],
      icon: '💬',
      connected: false,
      enabled: true,
      configFields: [
        { key: 'account', label: 'Account SID', type: 'text', placeholder: 'From Twilio Console', required: true },
        { key: 'api_key', label: 'Auth Token', type: 'password', placeholder: 'From Twilio Console', required: true },
        { key: 'phone_number', label: 'Twilio Phone Number', type: 'text', placeholder: '+1234567890', required: true },
      ],
    },
    {
      id: 'sendgrid',
      name: 'SendGrid',
      category: 'communication',
      description: 'Transactional email delivery',
      useCases: [
        'Proposal delivery emails',
        'Appointment confirmations',
        'Invoice and receipt emails',
      ],
      icon: '📧',
      connected: false,
      enabled: true,
      configFields: [
        { key: 'account', label: 'Sender Email', type: 'email', placeholder: 'noreply@yourcompany.com', required: true },
        { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'From SendGrid Settings → API Keys', required: true },
      ],
    },
    {
      id: 'google_calendar',
      name: 'Google Calendar',
      category: 'communication',
      description: 'Sync appointments with Google Calendar',
      useCases: [
        'Sync inspections to team calendars',
        'Crew scheduling visibility',
        'Avoid double-booking',
      ],
      icon: '📅',
      connected: false,
      enabled: true,
      configFields: [
        { key: 'account', label: 'Google Account', type: 'email', placeholder: 'your-email@gmail.com', required: true },
      ],
    },
    // AUTOMATION
    {
      id: 'zapier',
      name: 'Zapier',
      category: 'automation',
      description: 'Connect to 5000+ apps with automated workflows',
      useCases: [
        'Push new leads to other systems',
        'Trigger actions on deal stages',
        'Custom workflow automation',
      ],
      icon: '⚡',
      connected: false,
      enabled: true,
      configFields: [
        { key: 'webhook_url', label: 'Zapier Webhook URL', type: 'text', placeholder: 'https://hooks.zapier.com/...', required: true },
      ],
    },
  ]
  
  const [externalIntegrations, setExternalIntegrations] = useState<ExternalIntegration[]>(defaultIntegrations)
  const [editingIntegration, setEditingIntegration] = useState<ExternalIntegration | null>(null)
  const [showIntegrationModal, setShowIntegrationModal] = useState(false)
  const [integrationFilter, setIntegrationFilter] = useState<'all' | ExternalIntegration['category']>('all')

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
      
      // Load inspection outcomes from org settings
      if (data.settings?.inspection_outcomes) {
        setInspectionOutcomes(data.settings.inspection_outcomes)
      }
      
      // Load appointment types from org settings
      if (data.settings?.appointment_types) {
        setAppointmentTypes(data.settings.appointment_types)
      }
      
      // Load external integrations from org settings
      if (data.settings?.external_integrations_config) {
        setExternalIntegrations(prev => prev.map(integration => {
          const savedConfig = data.settings.external_integrations_config[integration.id]
          if (savedConfig) {
            return { ...integration, ...savedConfig }
          }
          return integration
        }))
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
      
      // Load report settings
      if (data.settings?.reports) {
        setReportSettings(prev => ({
          ...prev,
          ...data.settings.reports,
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

  const saveReportSettings = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'reports',
          reports: reportSettings,
        }),
      })
      
      if (!response.ok) {
        const data = await response.json()
        alert(data.error || 'Failed to save report settings')
        return
      }
      
      alert('Report settings saved!')
    } catch (error) {
      console.error('Error saving report settings:', error)
      alert('Failed to save report settings')
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
        { id: 'job-fields', label: 'Project Fields' },
        { id: 'job-workflows', label: 'Project Workflows' },
        { id: 'work-order-fields', label: 'Work Order Fields' },
        { id: 'work-order-workflows', label: 'Work Order Workflows' },
        { id: 'canvass-dispositions', label: 'Canvass Dispositions' },
        { id: 'inspection-outcomes', label: 'Inspection Outcomes' },
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
        { id: 'reports', label: 'Report Settings' },
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

          {/* Report Settings */}
          {activeSection === 'reports' && (
            <div className="max-w-2xl">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Report Settings</h1>
              <p className="text-gray-500 mb-6">Configure how reports display team member data.</p>
              
              <div className="bg-white rounded-xl shadow-sm border p-6 space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Role Inclusion</h2>
                  <p className="text-sm text-gray-500 mb-4">
                    Choose which roles are included in performance reports and leaderboards.
                  </p>
                  
                  <div className="space-y-4">
                    <label className="flex items-start gap-3 p-4 border rounded-lg hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={reportSettings.include_admins_in_reports}
                        onChange={(e) => setReportSettings(prev => ({ ...prev, include_admins_in_reports: e.target.checked }))}
                        className="mt-1 h-5 w-5 text-indigo-600 rounded border-gray-300"
                      />
                      <div>
                        <span className="font-medium text-gray-900">Include Admins in Reports</span>
                        <p className="text-sm text-gray-500 mt-1">
                          When enabled, admin users will appear in performance reports, leaderboards, and sales statistics. 
                          Disable this to exclude owners/admins from team performance metrics as your company grows.
                        </p>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="pt-4 border-t">
                  <button
                    onClick={saveReportSettings}
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

          {/* Inspection Outcomes */}
          {activeSection === 'inspection-outcomes' && (
            <div className="max-w-3xl">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Inspection Outcomes</h1>
                  <p className="text-gray-500 mt-1">Configure the outcomes closers can select after an inspection. Control which outcomes automatically create opportunities.</p>
                </div>
                <button
                  onClick={() => {
                    setEditingInspectionOutcome({
                      id: `outcome_${Date.now()}`,
                      label: '',
                      description: '',
                      color: '#3b82f6',
                      icon: '•',
                      active: true,
                      converts_to_opportunity: false,
                      sort_order: inspectionOutcomes.length,
                    })
                    setShowAddInspectionOutcome(true)
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
                >
                  + Add Outcome
                </button>
              </div>

              {/* Info Banner */}
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex gap-3">
                  <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="text-sm text-blue-700">
                    <p className="font-medium">How it works:</p>
                    <p className="mt-1">When a closer submits an inspection result, outcomes marked with &quot;Creates Opportunity&quot; will automatically convert the lead to an opportunity. Other outcomes will keep the lead as-is for follow-up.</p>
                  </div>
                </div>
              </div>

              {/* Outcomes List */}
              <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Icon</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Label</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Creates Opportunity</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {inspectionOutcomes.sort((a, b) => a.sort_order - b.sort_order).map((outcome) => (
                      <tr key={outcome.id} className={!outcome.active ? 'bg-gray-50 opacity-60' : ''}>
                        <td className="px-4 py-3">
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-lg font-bold"
                            style={{ backgroundColor: outcome.color }}
                          >
                            {outcome.icon}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-900">{outcome.label}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-gray-600">{outcome.description}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => {
                              setInspectionOutcomes(prev => prev.map(o => 
                                o.id === outcome.id ? { ...o, converts_to_opportunity: !o.converts_to_opportunity } : o
                              ))
                            }}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                              outcome.converts_to_opportunity 
                                ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                          >
                            {outcome.converts_to_opportunity ? '✓ Yes' : 'No'}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            outcome.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {outcome.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => {
                              setEditingInspectionOutcome(outcome)
                              setShowAddInspectionOutcome(true)
                            }}
                            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium mr-3"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              setInspectionOutcomes(prev => prev.map(o => 
                                o.id === outcome.id ? { ...o, active: !o.active } : o
                              ))
                            }}
                            className="text-gray-500 hover:text-gray-700 text-sm"
                          >
                            {outcome.active ? 'Disable' : 'Enable'}
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
                          type: 'inspection_outcomes',
                          inspection_outcomes: inspectionOutcomes,
                        }),
                      })
                      
                      if (!response.ok) {
                        const data = await response.json()
                        alert(data.error || 'Failed to save inspection outcomes')
                        return
                      }
                      
                      alert('Inspection outcomes saved!')
                    } catch (error) {
                      console.error('Error saving inspection outcomes:', error)
                      alert('Failed to save inspection outcomes')
                    } finally {
                      setSaving(false)
                    }
                  }}
                  disabled={saving}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Inspection Outcomes'}
                </button>
              </div>

              {/* Edit/Add Modal */}
              {showAddInspectionOutcome && editingInspectionOutcome && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
                    <div className="p-6 border-b">
                      <h2 className="text-xl font-bold text-gray-900">
                        {inspectionOutcomes.find(o => o.id === editingInspectionOutcome.id) ? 'Edit Outcome' : 'Add Outcome'}
                      </h2>
                    </div>
                    <div className="p-6 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Label *</label>
                        <input
                          type="text"
                          value={editingInspectionOutcome.label}
                          onChange={(e) => setEditingInspectionOutcome(prev => prev ? { ...prev, label: e.target.value } : null)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                          placeholder="e.g., Sale, Not Home"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                        <input
                          type="text"
                          value={editingInspectionOutcome.description}
                          onChange={(e) => setEditingInspectionOutcome(prev => prev ? { ...prev, description: e.target.value } : null)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                          placeholder="e.g., Customer signed the contract"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Icon (emoji or symbol)</label>
                        <input
                          type="text"
                          value={editingInspectionOutcome.icon}
                          onChange={(e) => setEditingInspectionOutcome(prev => prev ? { ...prev, icon: e.target.value.slice(0, 2) } : null)}
                          className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900"
                          placeholder="✓, ✗, →, ?, etc."
                          maxLength={2}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
                        <div className="flex gap-2 flex-wrap">
                          {[
                            '#22c55e', '#10b981', '#14b8a6', '#3b82f6', '#8b5cf6',
                            '#ec4899', '#ef4444', '#f97316', '#f59e0b', '#6b7280'
                          ].map((color) => (
                            <button
                              key={color}
                              type="button"
                              onClick={() => setEditingInspectionOutcome(prev => prev ? { ...prev, color } : null)}
                              className={`w-10 h-10 rounded-full border-2 ${
                                editingInspectionOutcome.color === color ? 'border-gray-900 scale-110' : 'border-transparent'
                              }`}
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-200">
                        <input
                          type="checkbox"
                          id="outcome-converts"
                          checked={editingInspectionOutcome.converts_to_opportunity}
                          onChange={(e) => setEditingInspectionOutcome(prev => prev ? { ...prev, converts_to_opportunity: e.target.checked } : null)}
                          className="w-5 h-5 rounded border-gray-300 text-green-600"
                        />
                        <label htmlFor="outcome-converts" className="text-sm text-gray-700">
                          <span className="font-medium">Creates Opportunity</span>
                          <p className="text-gray-500 text-xs mt-0.5">When selected, this outcome will automatically convert the lead to an opportunity</p>
                        </label>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          id="outcome-active"
                          checked={editingInspectionOutcome.active}
                          onChange={(e) => setEditingInspectionOutcome(prev => prev ? { ...prev, active: e.target.checked } : null)}
                          className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                        />
                        <label htmlFor="outcome-active" className="text-sm text-gray-700">Active</label>
                      </div>
                    </div>
                    <div className="p-6 border-t flex justify-between">
                      {inspectionOutcomes.find(o => o.id === editingInspectionOutcome.id) && (
                        <button
                          onClick={() => {
                            if (confirm('Delete this outcome?')) {
                              setInspectionOutcomes(prev => prev.filter(o => o.id !== editingInspectionOutcome.id))
                              setShowAddInspectionOutcome(false)
                              setEditingInspectionOutcome(null)
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
                            setShowAddInspectionOutcome(false)
                            setEditingInspectionOutcome(null)
                          }}
                          className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-900"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            if (!editingInspectionOutcome.label) {
                              alert('Please enter a label')
                              return
                            }
                            const exists = inspectionOutcomes.find(o => o.id === editingInspectionOutcome.id)
                            if (exists) {
                              setInspectionOutcomes(prev => prev.map(o => 
                                o.id === editingInspectionOutcome.id ? editingInspectionOutcome : o
                              ))
                            } else {
                              setInspectionOutcomes(prev => [...prev, editingInspectionOutcome])
                            }
                            setShowAddInspectionOutcome(false)
                            setEditingInspectionOutcome(null)
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
            <div className="max-w-4xl">
              <div className="mb-8">
                <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
                <p className="text-gray-600 mt-1">Connect your tools to streamline your workflow. Each integration shows exactly where it will be used.</p>
              </div>

              {/* Category Filter Pills */}
              <div className="flex flex-wrap gap-2 mb-6">
                {[
                  { id: 'all', label: 'All', icon: '📋' },
                  { id: 'signatures', label: 'E-Signatures', icon: '✍️' },
                  { id: 'measurements', label: 'Measurements', icon: '📐' },
                  { id: 'accounting', label: 'Accounting', icon: '💰' },
                  { id: 'communication', label: 'Communication', icon: '💬' },
                  { id: 'automation', label: 'Automation', icon: '⚡' },
                ].map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setIntegrationFilter(cat.id as any)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                      integrationFilter === cat.id
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    <span className="mr-1.5">{cat.icon}</span>
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Connected Integrations Summary */}
              {externalIntegrations.filter(i => i.connected).length > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-green-600 text-lg">✓</span>
                    <h3 className="font-semibold text-green-800">
                      {externalIntegrations.filter(i => i.connected).length} Active Integration{externalIntegrations.filter(i => i.connected).length !== 1 ? 's' : ''}
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {externalIntegrations.filter(i => i.connected).map(i => (
                      <span key={i.id} className="inline-flex items-center gap-1.5 px-3 py-1 bg-white rounded-full text-sm text-green-700 border border-green-200">
                        <span>{i.icon}</span>
                        {i.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Integration Cards by Category */}
              <div className="space-y-8">
                {(['signatures', 'measurements', 'accounting', 'communication', 'automation'] as const)
                  .filter(category => integrationFilter === 'all' || integrationFilter === category)
                  .map(category => {
                    const categoryIntegrations = externalIntegrations.filter(i => i.category === category)
                    if (categoryIntegrations.length === 0) return null
                    
                    const categoryLabels = {
                      signatures: { label: 'E-Signatures', desc: 'Send contracts and get them signed digitally', icon: '✍️' },
                      measurements: { label: 'Measurements & Design', desc: 'Get accurate roof measurements and 3D models', icon: '📐' },
                      accounting: { label: 'Accounting', desc: 'Sync invoices and financial data', icon: '💰' },
                      communication: { label: 'Communication', desc: 'Keep customers and team informed', icon: '💬' },
                      automation: { label: 'Automation', desc: 'Connect to other apps and automate workflows', icon: '⚡' },
                    }
                    
                    return (
                      <div key={category}>
                        <div className="flex items-center gap-2 mb-4">
                          <span className="text-xl">{categoryLabels[category].icon}</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">{categoryLabels[category].label}</h2>
                            <p className="text-sm text-gray-500">{categoryLabels[category].desc}</p>
                          </div>
                        </div>
                        
                        <div className="grid gap-4">
                          {categoryIntegrations.map((integration) => (
                            <div 
                              key={integration.id} 
                              className={`bg-white rounded-xl border-2 transition-all ${
                                integration.connected 
                                  ? 'border-green-200 shadow-sm' 
                                  : 'border-gray-100 hover:border-gray-200'
                              }`}
                            >
                              <div className="p-5">
                                <div className="flex items-start justify-between gap-4">
                                  <div className="flex items-start gap-4 flex-1">
                                    <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 ${
                                      integration.connected ? 'bg-green-100' : 'bg-gray-100'
                                    }`}>
                                      {integration.icon}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 mb-1">
                                        <h3 className="font-semibold text-gray-900">{integration.name}</h3>
                                        {integration.connected && (
                                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                            Connected
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-sm text-gray-600 mb-3">{integration.description}</p>
                                      
                                      {/* Use Cases - This is the key UX improvement */}
                                      <div className="space-y-1.5">
                                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Where this is used:</p>
                                        {integration.useCases.map((useCase, idx) => (
                                          <div key={idx} className="flex items-center gap-2 text-sm">
                                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                              integration.connected ? 'bg-green-500' : 'bg-gray-300'
                                            }`} />
                                            <span className={integration.connected ? 'text-gray-700' : 'text-gray-500'}>
                                              {useCase}
                                            </span>
                                          </div>
                                        ))}
                                      </div>

                                      {/* Connected Account Info */}
                                      {integration.connected && integration.config?.account && (
                                        <div className="mt-3 pt-3 border-t border-gray-100">
                                          <p className="text-sm text-gray-600">
                                            <span className="text-gray-500">Account:</span>{' '}
                                            <span className="font-medium">{integration.config.account}</span>
                                          </p>
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Action Buttons */}
                                  <div className="flex flex-col gap-2 flex-shrink-0">
                                    {integration.connected ? (
                                      <>
                                        <button
                                          onClick={() => {
                                            setEditingIntegration({ ...integration })
                                            setShowIntegrationModal(true)
                                          }}
                                          className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                                        >
                                          Edit Settings
                                        </button>
                                        <button
                                          onClick={() => {
                                            if (confirm(`Disconnect ${integration.name}? This will disable all features that use this integration.`)) {
                                              setExternalIntegrations(prev => prev.map(i => 
                                                i.id === integration.id ? { ...i, connected: false, config: undefined } : i
                                              ))
                                            }
                                          }}
                                          className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        >
                                          Disconnect
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        onClick={() => {
                                          const emptyConfig: IntegrationConfig = {}
                                          integration.configFields.forEach(f => {
                                            emptyConfig[f.key] = ''
                                          })
                                          setEditingIntegration({ ...integration, config: emptyConfig })
                                          setShowIntegrationModal(true)
                                        }}
                                        className="px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
                                      >
                                        Connect
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
              </div>

              {/* Save Button */}
              <div className="mt-8 pt-6 border-t flex items-center justify-between">
                <p className="text-sm text-gray-500">
                  Changes are saved when you connect or disconnect integrations.
                </p>
                <button
                  onClick={async () => {
                    setSaving(true)
                    try {
                      const configToSave: Record<string, any> = {}
                      externalIntegrations.forEach(integration => {
                        configToSave[integration.id] = {
                          connected: integration.connected,
                          enabled: integration.enabled,
                          config: integration.config,
                        }
                      })
                      
                      const response = await fetch('/api/admin/settings', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          type: 'external_integrations',
                          external_integrations_config: configToSave,
                        }),
                      })
                      
                      if (!response.ok) {
                        const data = await response.json()
                        alert(data.error || 'Failed to save integrations')
                        return
                      }
                      
                      alert('All integration settings saved!')
                    } catch (error) {
                      console.error('Error saving integrations:', error)
                      alert('Failed to save integrations')
                    } finally {
                      setSaving(false)
                    }
                  }}
                  disabled={saving}
                  className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
                >
                  {saving ? 'Saving...' : 'Save All Settings'}
                </button>
              </div>

              {/* Integration Connect/Edit Modal */}
              {showIntegrationModal && editingIntegration && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
                    {/* Modal Header */}
                    <div className="p-6 border-b sticky top-0 bg-white rounded-t-2xl">
                      <div className="flex items-center gap-4">
                        <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-2xl ${
                          editingIntegration.connected ? 'bg-green-100' : 'bg-indigo-100'
                        }`}>
                          {editingIntegration.icon}
                        </div>
                        <div>
                          <h2 className="text-xl font-bold text-gray-900">
                            {editingIntegration.connected ? 'Edit' : 'Connect'} {editingIntegration.name}
                          </h2>
                          <p className="text-sm text-gray-500">{editingIntegration.description}</p>
                        </div>
                      </div>
                    </div>

                    {/* What This Enables */}
                    <div className="p-6 bg-gray-50 border-b">
                      <h3 className="text-sm font-semibold text-gray-700 mb-3">What this enables:</h3>
                      <div className="space-y-2">
                        {editingIntegration.useCases.map((useCase, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="text-green-500">✓</span>
                            <span className="text-sm text-gray-700">{useCase}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Configuration Fields */}
                    <div className="p-6 space-y-4">
                      <h3 className="text-sm font-semibold text-gray-700">Connection Settings</h3>
                      
                      {editingIntegration.configFields.map((field) => (
                        <div key={field.key}>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            {field.label}
                            {field.required && <span className="text-red-500 ml-1">*</span>}
                          </label>
                          <input
                            type={field.type}
                            value={editingIntegration.config?.[field.key] || ''}
                            onChange={(e) => setEditingIntegration(prev => prev ? { 
                              ...prev, 
                              config: { ...prev.config, [field.key]: e.target.value } 
                            } : null)}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder={field.placeholder}
                          />
                        </div>
                      ))}

                      {/* Integration-specific help */}
                      {editingIntegration.id === 'eagleview' && (
                        <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                          <p className="text-sm text-blue-800 font-medium mb-1">How to get your API credentials:</p>
                          <ol className="text-sm text-blue-700 list-decimal list-inside space-y-1">
                            <li>Log into your EagleView account</li>
                            <li>Go to Account Settings → API Access</li>
                            <li>Generate or copy your API token</li>
                          </ol>
                        </div>
                      )}
                      {editingIntegration.id === 'dropbox_sign' && (
                        <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                          <p className="text-sm text-blue-800 font-medium mb-1">How to get your API key:</p>
                          <ol className="text-sm text-blue-700 list-decimal list-inside space-y-1">
                            <li>Log into Dropbox Sign</li>
                            <li>Go to Settings → API</li>
                            <li>Create or copy your API key</li>
                          </ol>
                        </div>
                      )}
                      {editingIntegration.id === 'twilio' && (
                        <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                          <p className="text-sm text-blue-800 font-medium mb-1">Where to find your credentials:</p>
                          <ol className="text-sm text-blue-700 list-decimal list-inside space-y-1">
                            <li>Log into Twilio Console</li>
                            <li>Account SID and Auth Token are on the dashboard</li>
                            <li>Get a phone number from Phone Numbers → Manage</li>
                          </ol>
                        </div>
                      )}
                      {(editingIntegration.id === 'quickbooks' || editingIntegration.id === 'xero') && (
                        <div className="p-4 bg-amber-50 rounded-lg border border-amber-100">
                          <p className="text-sm text-amber-800">
                            <strong>Note:</strong> Clicking Connect will redirect you to {editingIntegration.name} to authorize the connection.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Modal Footer */}
                    <div className="p-6 border-t bg-gray-50 rounded-b-2xl flex justify-between">
                      <button
                        onClick={() => {
                          setShowIntegrationModal(false)
                          setEditingIntegration(null)
                        }}
                        className="px-5 py-2.5 border border-gray-300 rounded-lg hover:bg-white text-gray-700 font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={async () => {
                          // Validate required fields
                          const missingFields = editingIntegration.configFields
                            .filter(f => f.required && !editingIntegration.config?.[f.key])
                            .map(f => f.label)
                          
                          if (missingFields.length > 0) {
                            alert(`Please fill in: ${missingFields.join(', ')}`)
                            return
                          }

                          // Update state
                          setExternalIntegrations(prev => prev.map(i => 
                            i.id === editingIntegration.id 
                              ? { ...editingIntegration, connected: true }
                              : i
                          ))

                          // Auto-save to backend
                          try {
                            const configToSave: Record<string, any> = {}
                            externalIntegrations.forEach(integration => {
                              if (integration.id === editingIntegration.id) {
                                configToSave[integration.id] = {
                                  connected: true,
                                  enabled: true,
                                  config: editingIntegration.config,
                                }
                              } else {
                                configToSave[integration.id] = {
                                  connected: integration.connected,
                                  enabled: integration.enabled,
                                  config: integration.config,
                                }
                              }
                            })
                            
                            await fetch('/api/admin/settings', {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                type: 'external_integrations',
                                external_integrations_config: configToSave,
                              }),
                            })
                          } catch (error) {
                            console.error('Error saving integration:', error)
                          }

                          setShowIntegrationModal(false)
                          setEditingIntegration(null)
                        }}
                        className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
                      >
                        {editingIntegration.connected ? 'Save Changes' : 'Connect Integration'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
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
                <button 
                  onClick={() => {
                    setEditingWorkOrderField(null)
                    setShowAddWorkOrderField(true)
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
                >
                  + Add Field
                </button>
              </div>
              
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <p className="text-gray-500 mb-6">Configure custom fields for work orders and crew assignments.</p>
                
                {/* Work Order Fields */}
                <div className="mb-8">
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Work Order Fields</h3>
                  <div className="space-y-3">
                    {workOrderFields.filter(f => f.applies_to === 'work_order' || f.applies_to === 'both').map((field) => (
                      <div key={field.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${field.active ? 'bg-green-500' : 'bg-gray-300'}`} />
                          <div>
                            <h4 className="font-medium text-gray-900">{field.name}</h4>
                            <p className="text-sm text-gray-500">
                              {field.field_type.charAt(0).toUpperCase() + field.field_type.slice(1)}
                              {field.required && <span className="text-red-500 ml-1">*</span>}
                              {field.applies_to === 'both' && <span className="ml-2 text-indigo-600">(Also on crew assignments)</span>}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => {
                              setEditingWorkOrderField(field)
                              setShowAddWorkOrderField(true)
                            }}
                            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                          >
                            Edit
                          </button>
                          <button 
                            onClick={() => {
                              setWorkOrderFields(prev => prev.map(f => 
                                f.id === field.id ? { ...f, active: !f.active } : f
                              ))
                            }}
                            className={`text-sm font-medium ${field.active ? 'text-amber-600 hover:text-amber-800' : 'text-green-600 hover:text-green-800'}`}
                          >
                            {field.active ? 'Disable' : 'Enable'}
                          </button>
                          <button 
                            onClick={() => {
                              if (confirm(`Delete field "${field.name}"?`)) {
                                setWorkOrderFields(prev => prev.filter(f => f.id !== field.id))
                              }
                            }}
                            className="text-red-600 hover:text-red-800 text-sm font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                    {workOrderFields.filter(f => f.applies_to === 'work_order' || f.applies_to === 'both').length === 0 && (
                      <p className="text-gray-400 text-sm py-4 text-center">No work order fields configured</p>
                    )}
                  </div>
                </div>
                
                {/* Crew Assignment Fields */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">Crew Assignment Fields</h3>
                  <div className="space-y-3">
                    {workOrderFields.filter(f => f.applies_to === 'crew_assignment' || f.applies_to === 'both').map((field) => (
                      <div key={field.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${field.active ? 'bg-green-500' : 'bg-gray-300'}`} />
                          <div>
                            <h4 className="font-medium text-gray-900">{field.name}</h4>
                            <p className="text-sm text-gray-500">
                              {field.field_type.charAt(0).toUpperCase() + field.field_type.slice(1)}
                              {field.required && <span className="text-red-500 ml-1">*</span>}
                              {field.applies_to === 'both' && <span className="ml-2 text-indigo-600">(Also on work orders)</span>}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => {
                              setEditingWorkOrderField(field)
                              setShowAddWorkOrderField(true)
                            }}
                            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                          >
                            Edit
                          </button>
                          <button 
                            onClick={() => {
                              setWorkOrderFields(prev => prev.map(f => 
                                f.id === field.id ? { ...f, active: !f.active } : f
                              ))
                            }}
                            className={`text-sm font-medium ${field.active ? 'text-amber-600 hover:text-amber-800' : 'text-green-600 hover:text-green-800'}`}
                          >
                            {field.active ? 'Disable' : 'Enable'}
                          </button>
                          <button 
                            onClick={() => {
                              if (confirm(`Delete field "${field.name}"?`)) {
                                setWorkOrderFields(prev => prev.filter(f => f.id !== field.id))
                              }
                            }}
                            className="text-red-600 hover:text-red-800 text-sm font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                    {workOrderFields.filter(f => f.applies_to === 'crew_assignment' || f.applies_to === 'both').length === 0 && (
                      <p className="text-gray-400 text-sm py-4 text-center">No crew assignment fields configured</p>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Add/Edit Work Order Field Modal */}
              {showAddWorkOrderField && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
                    <div className="p-6 border-b">
                      <h2 className="text-xl font-bold text-gray-900">
                        {editingWorkOrderField ? 'Edit Field' : 'Add Field'}
                      </h2>
                    </div>
                    <form onSubmit={(e) => {
                      e.preventDefault()
                      const formData = new FormData(e.currentTarget)
                      const fieldData: WorkOrderField = {
                        id: editingWorkOrderField?.id || `wo_field_${Date.now()}`,
                        name: formData.get('name') as string,
                        field_type: formData.get('field_type') as WorkOrderField['field_type'],
                        required: formData.get('required') === 'on',
                        applies_to: formData.get('applies_to') as WorkOrderField['applies_to'],
                        options: formData.get('field_type') === 'select' 
                          ? (formData.get('options') as string).split(',').map(o => o.trim()).filter(Boolean)
                          : undefined,
                        sort_order: editingWorkOrderField?.sort_order ?? workOrderFields.length,
                        active: editingWorkOrderField?.active ?? true,
                      }
                      
                      if (editingWorkOrderField) {
                        setWorkOrderFields(prev => prev.map(f => f.id === editingWorkOrderField.id ? fieldData : f))
                      } else {
                        setWorkOrderFields(prev => [...prev, fieldData])
                      }
                      setShowAddWorkOrderField(false)
                      setEditingWorkOrderField(null)
                    }}>
                      <div className="p-6 space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Field Name</label>
                          <input
                            type="text"
                            name="name"
                            required
                            defaultValue={editingWorkOrderField?.name || ''}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="e.g., Permit Number"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Field Type</label>
                          <select
                            name="field_type"
                            defaultValue={editingWorkOrderField?.field_type || 'text'}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                          >
                            <option value="text">Text</option>
                            <option value="textarea">Text Area</option>
                            <option value="number">Number</option>
                            <option value="date">Date</option>
                            <option value="select">Dropdown</option>
                            <option value="checkbox">Checkbox</option>
                          </select>
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Options (for dropdown, comma-separated)</label>
                          <input
                            type="text"
                            name="options"
                            defaultValue={editingWorkOrderField?.options?.join(', ') || ''}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="Option 1, Option 2, Option 3"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Applies To</label>
                          <select
                            name="applies_to"
                            defaultValue={editingWorkOrderField?.applies_to || 'work_order'}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                          >
                            <option value="work_order">Work Orders Only</option>
                            <option value="crew_assignment">Crew Assignments Only</option>
                            <option value="both">Both</option>
                          </select>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            name="required"
                            id="field_required"
                            defaultChecked={editingWorkOrderField?.required || false}
                            className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                          />
                          <label htmlFor="field_required" className="text-sm text-gray-700">Required field</label>
                        </div>
                      </div>
                      
                      <div className="p-6 border-t flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddWorkOrderField(false)
                            setEditingWorkOrderField(null)
                          }}
                          className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                        >
                          {editingWorkOrderField ? 'Save Changes' : 'Add Field'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Work Order Workflows */}
          {activeSection === 'work-order-workflows' && (
            <div className="max-w-3xl">
              <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Work Order Workflows</h1>
                <button 
                  onClick={() => {
                    setEditingWorkOrderStage(null)
                    setShowAddWorkOrderStage(true)
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium"
                >
                  + Add Stage
                </button>
              </div>
              
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <p className="text-gray-500 mb-6">Define workflow stages for work orders. Drag to reorder stages.</p>
                
                <div className="space-y-3">
                  {workOrderStages.sort((a, b) => a.sort_order - b.sort_order).map((stage, index) => (
                    <div key={stage.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-4">
                        <div className="flex flex-col gap-1">
                          <button 
                            onClick={() => {
                              if (index > 0) {
                                setWorkOrderStages(prev => {
                                  const sorted = [...prev].sort((a, b) => a.sort_order - b.sort_order)
                                  const newStages = [...sorted]
                                  const temp = newStages[index].sort_order
                                  newStages[index].sort_order = newStages[index - 1].sort_order
                                  newStages[index - 1].sort_order = temp
                                  return newStages
                                })
                              }
                            }}
                            disabled={index === 0}
                            className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                            </svg>
                          </button>
                          <button 
                            onClick={() => {
                              if (index < workOrderStages.length - 1) {
                                setWorkOrderStages(prev => {
                                  const sorted = [...prev].sort((a, b) => a.sort_order - b.sort_order)
                                  const newStages = [...sorted]
                                  const temp = newStages[index].sort_order
                                  newStages[index].sort_order = newStages[index + 1].sort_order
                                  newStages[index + 1].sort_order = temp
                                  return newStages
                                })
                              }
                            }}
                            disabled={index === workOrderStages.length - 1}
                            className="text-gray-400 hover:text-gray-600 disabled:opacity-30"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </div>
                        <div 
                          className="w-4 h-4 rounded-full" 
                          style={{ backgroundColor: stage.color }}
                        />
                        <div>
                          <h4 className="font-medium text-gray-900 flex items-center gap-2">
                            {stage.name}
                            {stage.is_default && (
                              <span className="px-2 py-0.5 bg-gray-200 text-gray-600 text-xs rounded-full">Default</span>
                            )}
                            {stage.is_complete_stage && (
                              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">Complete</span>
                            )}
                          </h4>
                          <div className="flex items-center gap-2 text-sm text-gray-500">
                            {stage.notify_customer && (
                              <span className="flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                </svg>
                                Notifies customer
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => {
                            setEditingWorkOrderStage(stage)
                            setShowAddWorkOrderStage(true)
                          }}
                          className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                        >
                          Edit
                        </button>
                        {!stage.is_default && !stage.is_complete_stage && (
                          <button 
                            onClick={() => {
                              if (confirm(`Delete stage "${stage.name}"?`)) {
                                setWorkOrderStages(prev => prev.filter(s => s.id !== stage.id))
                              }
                            }}
                            className="text-red-600 hover:text-red-800 text-sm font-medium"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                
                <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-100">
                  <p className="text-sm text-blue-700">
                    <strong>Tip:</strong> The "Default" stage is assigned to new work orders. The "Complete" stage marks work orders as finished.
                  </p>
                </div>
              </div>
              
              {/* Add/Edit Work Order Stage Modal */}
              {showAddWorkOrderStage && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
                    <div className="p-6 border-b">
                      <h2 className="text-xl font-bold text-gray-900">
                        {editingWorkOrderStage ? 'Edit Stage' : 'Add Stage'}
                      </h2>
                    </div>
                    <form onSubmit={(e) => {
                      e.preventDefault()
                      const formData = new FormData(e.currentTarget)
                      const stageData: WorkOrderWorkflowStage = {
                        id: editingWorkOrderStage?.id || `stage_${Date.now()}`,
                        name: formData.get('name') as string,
                        color: formData.get('color') as string,
                        sort_order: editingWorkOrderStage?.sort_order ?? workOrderStages.length,
                        is_default: formData.get('is_default') === 'on',
                        is_complete_stage: formData.get('is_complete_stage') === 'on',
                        notify_customer: formData.get('notify_customer') === 'on',
                      }
                      
                      if (editingWorkOrderStage) {
                        setWorkOrderStages(prev => prev.map(s => s.id === editingWorkOrderStage.id ? stageData : s))
                      } else {
                        setWorkOrderStages(prev => [...prev, stageData])
                      }
                      
                      // If this is set as default, unset other defaults
                      if (stageData.is_default) {
                        setWorkOrderStages(prev => prev.map(s => 
                          s.id !== stageData.id ? { ...s, is_default: false } : s
                        ))
                      }
                      
                      // If this is set as complete stage, unset other complete stages
                      if (stageData.is_complete_stage) {
                        setWorkOrderStages(prev => prev.map(s => 
                          s.id !== stageData.id ? { ...s, is_complete_stage: false } : s
                        ))
                      }
                      
                      setShowAddWorkOrderStage(false)
                      setEditingWorkOrderStage(null)
                    }}>
                      <div className="p-6 space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Stage Name</label>
                          <input
                            type="text"
                            name="name"
                            required
                            defaultValue={editingWorkOrderStage?.name || ''}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="e.g., In Progress"
                          />
                        </div>
                        
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
                          <div className="flex items-center gap-3">
                            <input
                              type="color"
                              name="color"
                              defaultValue={editingWorkOrderStage?.color || '#3b82f6'}
                              className="w-12 h-10 rounded border border-gray-300 cursor-pointer"
                            />
                            <div className="flex gap-2">
                              {['#6b7280', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'].map(color => (
                                <button
                                  key={color}
                                  type="button"
                                  onClick={(e) => {
                                    const colorInput = e.currentTarget.parentElement?.parentElement?.querySelector('input[type="color"]') as HTMLInputElement
                                    if (colorInput) colorInput.value = color
                                  }}
                                  className="w-6 h-6 rounded-full border-2 border-white shadow-sm hover:scale-110 transition-transform"
                                  style={{ backgroundColor: color }}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                        
                        <div className="space-y-3 pt-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              name="is_default"
                              id="stage_is_default"
                              defaultChecked={editingWorkOrderStage?.is_default || false}
                              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                            />
                            <label htmlFor="stage_is_default" className="text-sm text-gray-700">
                              Default stage for new work orders
                            </label>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              name="is_complete_stage"
                              id="stage_is_complete"
                              defaultChecked={editingWorkOrderStage?.is_complete_stage || false}
                              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                            />
                            <label htmlFor="stage_is_complete" className="text-sm text-gray-700">
                              This stage marks work order as complete
                            </label>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              name="notify_customer"
                              id="stage_notify_customer"
                              defaultChecked={editingWorkOrderStage?.notify_customer || false}
                              className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                            />
                            <label htmlFor="stage_notify_customer" className="text-sm text-gray-700">
                              Notify customer when entering this stage
                            </label>
                          </div>
                        </div>
                      </div>
                      
                      <div className="p-6 border-t flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddWorkOrderStage(false)
                            setEditingWorkOrderStage(null)
                          }}
                          className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                        >
                          {editingWorkOrderStage ? 'Save Changes' : 'Add Stage'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
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
