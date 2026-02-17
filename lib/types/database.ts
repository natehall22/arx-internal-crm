export type UserRole = 
  | 'admin' 
  | 'owner'
  // Regional level
  | 'regional_manager' 
  | 'regional_setter_manager'
  // Manager level
  | 'sales_manager' 
  | 'setter_manager'
  // Rep level
  | 'sales_rep' 
  | 'setter'
  | 'rep' 
  | 'canvasser' 
  // Operations
  | 'operations'
  // Custom (for flexibility)
  | 'custom'

export type LeadStatus = 'new' | 'contacted' | 'appointment' | 'inspection' | 'estimate_sent' | 'won' | 'lost'

export type CanvassDisposition =
  | 'not_home'
  | 'bad_roof'
  | 'renter'
  | 'go_back'
  | 'hot_lead'
  | 'not_interested'

export type ProjectStatus = 'open' | 'in_progress' | 'on_hold' | 'complete' | 'collected'

export type ProjectType = 'roofing' | 'siding' | 'windows' | 'mixed'

export type OpportunityStatus = 'open' | 'in_progress' | 'won' | 'lost'

export type ActivityType = 'note' | 'call' | 'text' | 'email' | 'visit' | 'status_change'

export type FileTag = 'photo' | 'document' | 'proposal' | 'contract' | 'other'

export type PricebookCategory = 'roofing' | 'siding' | 'windows' | 'addons'

export type PricebookItemType = 'install' | 'tearoff' | 'material' | 'addon' | 'disposal' | 'cleanup' | 'dumpster' | 'decking' | 'flashing'

export type Unit = 'square' | 'each' | 'lf' | 'sheet' | 'job'

export type EstimateStatus = 'draft' | 'sent' | 'approved' | 'declined'

export interface Org {
  id: string
  name: string
  created_at: string
  updated_at: string
}

export interface User {
  id: string
  org_id: string
  manager_user_id: string | null
  team_id: string | null
  region_id: string | null
  role: UserRole
  custom_role_id: string | null
  full_name: string | null
  phone: string | null
  email: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface UserWithCustomRole extends User {
  custom_role?: CustomRoleWithPermissions | null
}

export interface Region {
  id: string
  org_id: string
  name: string
  created_at: string
  updated_at: string
}

export interface Team {
  id: string
  org_id: string
  region_id: string | null
  name: string
  created_at: string
  updated_at: string
}

export interface TeamCloserQueue {
  id: string
  org_id: string
  team_id: string
  user_id: string
  priority: number
  buffer_minutes: number
  buffer_before: number
  buffer_after: number
  active: boolean
  last_assigned_at: string | null
  created_at: string
  updated_at: string
}

export interface UserGoogleToken {
  id: string
  org_id: string
  user_id: string
  access_token: string
  refresh_token: string
  token_type: string
  expires_at: string
  scope: string | null
  created_at: string
  updated_at: string
}

export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show'

export type InspectionOutcome = 'not_home' | 'said_no' | 'failed_credit' | 'rescheduled' | 'sale'

export interface InspectionStatusUpdate {
  id: string
  org_id: string
  appointment_id: string
  opportunity_id: string | null
  lead_id: string | null
  closer_user_id: string
  setter_user_id: string | null
  outcome: InspectionOutcome
  notes: string | null
  setter_feedback: string | null
  prompted_at: string | null
  completed_at: string
  created_at: string
  updated_at: string
}

export interface Notification {
  id: string
  org_id: string
  user_id: string
  type: string
  title: string
  body: string | null
  data: Record<string, any> | null
  read_at: string | null
  created_at: string
}

export interface PendingStatusPrompt {
  id: string
  org_id: string
  appointment_id: string
  closer_user_id: string
  prompt_at: string
  dismissed: boolean
  completed: boolean
  created_at: string
}

export interface DashboardSettings {
  id: string
  org_id: string
  region_id: string | null
  team_id: string | null
  user_id: string | null
  settings: {
    widgets?: string[]
    layout?: string
    metrics?: string[]
    goals?: Record<string, number>
  }
  created_at: string
  updated_at: string
}

export type ReportType = 'table' | 'bar_chart' | 'line_chart' | 'pie_chart' | 'metric_card' | 'funnel'
export type ReportDataSource = 'leads' | 'opportunities' | 'projects' | 'appointments' | 'users' | 'activities' | 'inspection_outcomes'

export interface CustomReport {
  id: string
  org_id: string
  created_by: string
  name: string
  description: string | null
  report_type: ReportType
  data_source: ReportDataSource
  config: {
    columns?: string[]
    groupBy?: string
    aggregation?: string
    filters?: Record<string, any>
    dateRange?: string
    sortBy?: string
    sortOrder?: 'asc' | 'desc'
    chartConfig?: Record<string, any>
  }
  is_public: boolean
  is_dashboard_widget: boolean
  dashboard_position: number | null
  created_at: string
  updated_at: string
}

export interface ReportRoleAccess {
  id: string
  report_id: string
  role: string
  custom_role_id: string | null
  can_view: boolean
  can_edit: boolean
  created_at: string
}

export interface ReportSchedule {
  id: string
  org_id: string
  report_id: string
  created_by: string
  frequency: 'daily' | 'weekly' | 'monthly'
  day_of_week: number | null
  day_of_month: number | null
  time_of_day: string
  recipients: string[]
  last_sent_at: string | null
  next_send_at: string | null
  active: boolean
  created_at: string
  updated_at: string
}

// Permission categories
export type PermissionCategory = 
  | 'Canvassing'
  | 'Leads'
  | 'Opportunities'
  | 'Proposals'
  | 'Contracts'
  | 'Projects'
  | 'Reports'
  | 'Teams'
  | 'Regions'
  | 'Users'
  | 'Scheduling'
  | 'Pricebook'
  | 'Admin'

export interface Permission {
  id: string
  name: string
  display_name: string
  description: string | null
  category: PermissionCategory
  created_at: string
}

export interface CustomRole {
  id: string
  org_id: string
  name: string
  display_name: string
  description: string | null
  hierarchy_level: number
  is_system_role: boolean
  parent_role_id: string | null
  created_at: string
  updated_at: string
}

export interface RolePermission {
  id: string
  role_id: string
  permission_id: string
  created_at: string
}

export interface CustomRoleWithPermissions extends CustomRole {
  permissions: Permission[]
  parent_role?: CustomRole | null
}

export interface ScheduledAppointment {
  id: string
  org_id: string
  lead_id: string | null
  opportunity_id: string | null
  closer_user_id: string
  canvasser_user_id: string | null
  google_event_id: string | null
  scheduled_for: string
  duration_minutes: number
  status: AppointmentStatus
  address_text: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Lead {
  id: string
  org_id: string
  owner_user_id: string | null
  closer_user_id: string | null
  status: LeadStatus
  source: string | null
  address_text: string | null
  lat: number | null
  lng: number | null
  homeowner_name: string | null
  phone: string | null
  email: string | null
  notes: string | null
  canvass_disposition: CanvassDisposition | null
  canvass_notes: string | null
  inspection_scheduled_at: string | null
  inspection_scheduled_for: string | null
  created_at: string
  updated_at: string
}

export interface Customer {
  id: string
  org_id: string
  name: string | null
  phone: string | null
  email: string | null
  address_text: string | null
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  org_id: string
  customer_id: string | null
  lead_id: string | null
  owner_user_id: string | null
  status: ProjectStatus
  project_type: ProjectType
  address_text: string | null
  lat: number | null
  lng: number | null
  roof_squares: number | null
  siding_squares: number | null
  vents_count: number
  layers: number
  total_windows: number
  windows_by_type: Record<string, number> | null
  notes: string | null
  contract_sent_at: string | null
  contract_uploaded_at: string | null
  contract_pdf_path: string | null
  scope_of_work: string | null
  permits_status: string | null
  product_summary: string | null
  install_date: string | null
  ops_notes: string | null
  created_at: string
  updated_at: string
}

export interface Opportunity {
  id: string
  org_id: string
  customer_id: string | null
  lead_id: string | null
  owner_user_id: string | null
  status: OpportunityStatus
  project_type: ProjectType
  address_text: string | null
  lat: number | null
  lng: number | null
  roof_squares: number | null
  siding_squares: number | null
  vents_count: number
  layers: number
  total_windows: number
  windows_by_type: Record<string, number> | null
  notes: string | null
  design_pdf_path: string | null
  created_at: string
  updated_at: string
}

export interface Contract {
  id: string
  org_id: string
  project_id: string
  contract_pdf_path: string
  token: string
  status: string
  signed_at: string | null
  signed_name: string | null
  signed_email: string | null
  signed_ip: string | null
  signed_user_agent: string | null
  signed_location_text: string | null
  audit_pdf_path: string | null
  sent_to_email: string | null
  sent_at: string | null
  contract_payload: Record<string, any> | null
  rep_signed_at: string | null
  customer_signed_at: string | null
  created_at: string
}

export interface ContractTemplate {
  id: string
  org_id: string
  name: string
  storage_path: string
  active: boolean
  created_at: string
}

export interface ContractSignature {
  id: string
  org_id: string
  contract_id: string
  role: 'rep' | 'customer'
  signed_name: string | null
  signed_title: string | null
  signed_email: string | null
  signature_type: string | null
  signature_data: string | null
  signed_at: string
  signed_ip: string | null
  signed_user_agent: string | null
  signed_location_text: string | null
  created_at: string
}

export interface Notification {
  id: string
  org_id: string
  recipient_user_id: string
  actor_user_id: string | null
  type: string
  title: string
  body: string | null
  link_url: string | null
  read_at: string | null
  created_at: string
}

export interface Activity {
  id: string
  org_id: string
  lead_id: string | null
  opportunity_id: string | null
  project_id: string | null
  customer_id: string | null
  user_id: string
  type: ActivityType
  body: string
  created_at: string
  updated_at: string
}

export interface File {
  id: string
  org_id: string
  lead_id: string | null
  opportunity_id: string | null
  project_id: string | null
  customer_id: string | null
  user_id: string
  storage_path: string
  file_name: string
  mime_type: string
  tag: FileTag
  created_at: string
  updated_at: string
}

export interface Pricebook {
  id: string
  org_id: string
  name: string
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface PricebookItem {
  id: string
  org_id: string
  pricebook_id: string
  category: PricebookCategory
  item_type: PricebookItemType
  name: string
  unit: Unit
  unit_price: number
  is_labor: boolean
  is_taxable: boolean
  active: boolean
  created_at: string
  updated_at: string
}

export interface Estimate {
  id: string
  org_id: string
  project_id: string
  status: EstimateStatus
  steep_multiplier_pct: number
  high_multiplier_pct: number
  tax_rate: number
  discount_amount: number
  subtotal: number
  tax: number
  total: number
  scope_text: string | null
  proposal_pdf_path: string | null
  created_at: string
  updated_at: string
}

export interface EstimateLine {
  id: string
  org_id: string
  estimate_id: string
  pricebook_item_id: string | null
  category: PricebookCategory
  name: string
  unit: Unit
  qty: number
  unit_price: number
  line_total: number
  is_labor: boolean
  is_taxable: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

// Commission Types
export type CompPlanType = 'flat_rate' | 'percentage' | 'tiered' | 'hybrid'
export type CommissionStatus = 'pending' | 'approved' | 'paid' | 'disputed'

export interface CompPlan {
  id: string
  org_id: string
  name: string
  description: string | null
  plan_type: CompPlanType
  is_active: boolean
  is_default: boolean
  flat_amount: number | null
  base_percentage: number | null
  tiers: { min: number; max: number | null; rate: number }[] | null
  bonuses: { type: string; target: number; bonus: number }[] | null
  applicable_roles: string[]
  created_at: string
  updated_at: string
}

export interface UserCompPlan {
  id: string
  org_id: string
  user_id: string
  comp_plan_id: string
  effective_from: string
  effective_to: string | null
  override_percentage: number | null
  notes: string | null
  created_at: string
}

export interface Commission {
  id: string
  org_id: string
  user_id: string
  project_id: string | null
  opportunity_id: string | null
  comp_plan_id: string | null
  sale_amount: number
  commission_rate: number
  commission_amount: number
  bonus_amount: number
  total_amount: number
  status: CommissionStatus
  approved_by: string | null
  approved_at: string | null
  paid_at: string | null
  commission_period: string
  notes: string | null
  created_at: string
  updated_at: string
}

// User Settings
export interface UserSettings {
  id: string
  user_id: string
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
  ai_auto_notes: boolean
  theme: string
  dashboard_layout: any
  created_at: string
  updated_at: string
}

// AI Types
export interface AIConversation {
  id: string
  org_id: string
  user_id: string
  context_type: string | null
  context_id: string | null
  messages: { role: 'user' | 'assistant' | 'system'; content: string; timestamp?: string }[]
  created_at: string
  updated_at: string
}

export interface AISuggestion {
  id: string
  org_id: string
  user_id: string
  suggestion_type: string
  context_type: string | null
  context_id: string | null
  suggestion: string
  was_accepted: boolean | null
  feedback: string | null
  created_at: string
}

// Integration Types
export type IntegrationProvider = 
  | 'eagleview'
  | 'roofr'
  | 'solo'
  | 'aurora'
  | 'gaf_quickmeasure'
  | 'hover'
  | 'nearmap'
  | 'google_solar'

export type MeasurementStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type RoofMaterial = 
  | 'asphalt_shingle'
  | 'metal'
  | 'tile'
  | 'slate'
  | 'wood_shake'
  | 'flat_membrane'
  | 'other'

export interface IntegrationConfig {
  id: string
  org_id: string
  provider: IntegrationProvider
  is_enabled: boolean
  api_key: string | null
  api_secret: string | null
  client_id: string | null
  access_token: string | null
  refresh_token: string | null
  token_expires_at: string | null
  settings: Record<string, any>
  webhook_url: string | null
  webhook_secret: string | null
  created_at: string
  updated_at: string
}

export interface RoofMeasurement {
  id: string
  org_id: string
  opportunity_id: string | null
  project_id: string | null
  proposal_id: string | null
  created_by: string
  address_text: string
  lat: number | null
  lng: number | null
  source: string
  external_report_id: string | null
  external_report_url: string | null
  status: MeasurementStatus
  total_area_sqft: number | null
  total_squares: number | null
  ridges_lf: number | null
  hips_lf: number | null
  valleys_lf: number | null
  eaves_lf: number | null
  rakes_lf: number | null
  flashing_lf: number | null
  step_flashing_lf: number | null
  drip_edge_lf: number | null
  predominant_pitch: string | null
  pitch_count: number | null
  stories: number
  roof_material: RoofMaterial | null
  roof_age_years: number | null
  facet_count: number | null
  penetration_count: number | null
  chimney_count: number | null
  skylight_count: number | null
  suggested_waste_percent: number
  raw_data: Record<string, any> | null
  satellite_image_url: string | null
  annotated_image_url: string | null
  created_at: string
  updated_at: string
}

export interface RoofFacet {
  id: string
  measurement_id: string
  facet_number: number
  area_sqft: number
  pitch: string | null
  pitch_degrees: number | null
  orientation: string | null
  polygon_coords: { lat: number; lng: number }[] | null
  has_penetrations: boolean
  notes: string | null
  created_at: string
}

export interface MeasurementRequest {
  id: string
  org_id: string
  measurement_id: string | null
  provider: IntegrationProvider
  address_text: string
  lat: number | null
  lng: number | null
  external_order_id: string | null
  status: MeasurementStatus
  error_message: string | null
  callback_received_at: string | null
  requested_by: string
  created_at: string
  updated_at: string
}

// Work Order Types
export type WorkOrderType = 
  | 'go_back'
  | 'repair'
  | 'warranty'
  | 'punch_list'
  | 'inspection'
  | 'install'
  | 'service_call'

export type WorkOrderStatus = 
  | 'pending'
  | 'assigned'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'on_hold'

export type WorkOrderPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface SubContractor {
  id: string
  org_id: string
  company_name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  license_number: string | null
  insurance_expiry: string | null
  w9_on_file: boolean
  services: string[]
  service_area: string[]
  rating: number | null
  internal_notes: string | null
  portal_access_token: string | null
  portal_access_enabled: boolean
  last_portal_access: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface WorkOrder {
  id: string
  org_id: string
  work_order_number: string
  project_id: string | null
  customer_id: string | null
  work_order_type: WorkOrderType
  status: WorkOrderStatus
  priority: WorkOrderPriority
  assigned_user_id: string | null
  assigned_sub_id: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  title: string
  description: string | null
  scope_of_work: string | null
  materials: { name: string; quantity: string; unit: string }[]
  scheduled_date: string | null
  scheduled_time_start: string | null
  scheduled_time_end: string | null
  estimated_hours: number | null
  completed_at: string | null
  completed_by: string | null
  completion_notes: string | null
  before_photos: string[]
  after_photos: string[]
  estimated_cost: number | null
  actual_cost: number | null
  billable_to_customer: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface WorkOrderComment {
  id: string
  org_id: string
  work_order_id: string
  user_id: string | null
  sub_id: string | null
  comment: string
  is_internal: boolean
  created_at: string
}

export interface WorkOrderStatusHistory {
  id: string
  work_order_id: string
  old_status: WorkOrderStatus | null
  new_status: WorkOrderStatus
  changed_by: string | null
  notes: string | null
  created_at: string
}

// ============================================
// OPERATIONS / PRODUCTION TYPES
// ============================================

export type JobStatus = 
  | 'sold'           // Contract signed, ready for ops
  | 'materials'      // Materials being ordered
  | 'scheduled'      // Install date set
  | 'in_progress'    // Work in progress
  | 'complete'       // Work done, pending collection
  | 'collected'      // Payment collected
  | 'on_hold'        // Paused for some reason

export type CrewType = 'roofing' | 'siding' | 'gutters' | 'windows' | 'general'

export interface Crew {
  id: string
  org_id: string
  name: string
  crew_type: CrewType
  foreman_user_id: string | null
  members: string[]  // Array of user IDs
  color: string      // For calendar display
  phone: string | null
  daily_capacity: number  // Jobs per day
  active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface ProductionJob {
  id: string
  org_id: string
  project_id: string
  customer_id: string | null
  job_number: string
  status: JobStatus
  job_type: ProjectType
  address_text: string
  lat: number | null
  lng: number | null
  // Sales info
  sale_amount: number | null
  sale_date: string | null
  salesperson_id: string | null
  // Materials
  materials_status: 'not_ordered' | 'ordered' | 'partial' | 'received'
  materials_ordered_at: string | null
  materials_eta: string | null
  materials_notes: string | null
  // Scheduling
  scheduled_date: string | null
  scheduled_time_start: string | null
  scheduled_time_end: string | null
  estimated_duration_hours: number | null
  // Assignment
  assigned_crew_id: string | null
  assigned_sub_id: string | null
  // Permits
  permit_required: boolean
  permit_status: 'not_needed' | 'pending' | 'approved' | 'denied'
  permit_number: string | null
  // Completion
  started_at: string | null
  completed_at: string | null
  completion_notes: string | null
  // Photos
  before_photos: string[]
  progress_photos: string[]
  after_photos: string[]
  // Financials
  labor_cost: number | null
  material_cost: number | null
  // Meta
  priority: 'normal' | 'high' | 'urgent'
  internal_notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface ProductionJobNote {
  id: string
  job_id: string
  user_id: string
  note: string
  is_internal: boolean
  created_at: string
}

export interface MaterialOrder {
  id: string
  org_id: string
  job_id: string
  supplier: string
  order_number: string | null
  items: { name: string; quantity: number; unit: string; cost: number | null }[]
  status: 'pending' | 'ordered' | 'shipped' | 'delivered'
  ordered_at: string | null
  expected_delivery: string | null
  delivered_at: string | null
  total_cost: number | null
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}
