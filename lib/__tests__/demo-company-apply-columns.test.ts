/** @jest-environment node */
/**
 * The demo apply layer writes a few tables directly (no app writer is practical from a script). A wrong column name would
 * only show up against a real database, so this checks every column it writes appears in a migration for that table.
 */
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const dir = join(process.cwd(), 'supabase', 'migrations')
const sqlFiles = readdirSync(dir).filter((f) => f.endsWith('.sql') && !/^(FULL_COMBINED|RESET_AND_INIT)/.test(f))
const all = sqlFiles.map((f) => readFileSync(join(dir, f), 'utf8').toLowerCase().replace(/--[^\n]*/g, '')).join('\n')

/** Does some migration mention `col` in a statement about `table` (create table body, add column, or a comment)? */
/** Tables that were renamed after their columns were added (jobs → projects, 011_opportunities_projects.sql). */
const FORMER_NAMES: Record<string, string> = { projects: 'jobs' }

function mentioned(table: string, col: string): boolean {
  if (FORMER_NAMES[table] && mentionedAs(FORMER_NAMES[table], col)) return true
  return mentionedAs(table, col)
}

function mentionedAs(table: string, col: string): boolean {
  const c = col.toLowerCase()
  const re = new RegExp(`(create table[^;]*?\\b${table}\\b[^;]*?\\b${c}\\b|alter table[^;]*?\\b${table}\\b[^;]*?\\b${c}\\b|on ${table}\\s*\\([^)]*\\b${c}\\b|\\b${table}\\.${c}\\b)`, 's')
  return re.test(all)
}

const WRITES: Record<string, string[]> = {
  org_sms: ['e164', 'number_kind', 'number_source', 'status', 'approved_at', 'updated_by', 'updated_at'],
  comp_plans: ['name', 'plan_type', 'flat_amount', 'hourly_rate', 'is_active', 'base_percentage', 'applicable_roles'],
  user_comp_plans: ['user_id', 'comp_plan_id', 'effective_from', 'hourly_rate_override'],
  sub_contractors: ['company_name', 'contact_name', 'phone', 'email', 'services', 'active'],
  time_entries: ['user_id', 'sub_id', 'kind', 'started_at', 'ended_at', 'pricebook_item_id', 'production_job_id', 'source', 'end_source', 'tapped_via', 'tapped_by_user_id', 'ended_by_user_id'],
  opportunities: ['customer_id', 'owner_user_id', 'status', 'address_text', 'notes'],
  proposals: ['opportunity_id', 'created_by', 'customer_name', 'customer_email', 'customer_phone', 'customer_address', 'proposal_number', 'title', 'status', 'subtotal', 'total', 'sent_at', 'accepted_at', 'expires_at', 'scope_of_work', 'deposit_mode', 'deposit_value'],
  proposal_line_items: ['proposal_id', 'category', 'name', 'unit', 'quantity', 'unit_price', 'line_total', 'is_adder', 'show_on_pdf', 'sort_order', 'is_optional', 'optional_default_on', 'show_to_customer', 'taxable'],
  quote_links: ['proposal_id', 'token_hash', 'created_by', 'expires_at', 'sent_to', 'sent_at'],
  quote_approvals: ['proposal_id', 'opportunity_id', 'link_id', 'typed_name', 'approved_at', 'approved_ip', 'selected_item_ids', 'snapshot', 'subtotal_cents', 'discount_cents', 'tax_cents', 'total_cents', 'deposit_cents', 'job_id', 'deposit_invoice_id', 'finalized_at'],
  projects: ['customer_id', 'address_text', 'status', 'owner_user_id'],
  production_jobs: ['project_id', 'customer_id', 'address_text', 'job_type', 'status', 'sale_amount', 'sale_date', 'accepted_proposal_id', 'salesperson_id', 'created_by', 'property_id', 'billing_mode', 'estimated_hours', 'hourly_rate_item_id'],
  vendors: ['name', 'contact_name', 'phone', 'email', 'active', 'created_by', 'vendor_type'],
  supplier_orders: ['status', 'first_sent_at', 'last_sent_at'],
  job_invoices: ['status', 'issued_at', 'sent_at', 'due_at'],
  portal_login_tokens: ['customer_id', 'token_hash', 'sent_to', 'expires_at'],
  pricebooks: ['name', 'is_default'],
  pricebook_items: ['pricebook_id', 'category', 'item_type', 'name', 'unit', 'unit_price', 'is_labor', 'is_taxable', 'active'],
  users: ['email', 'full_name', 'phone', 'role', 'active', 'dashboard_view', 'canvass_pin_visibility'],
}

describe('demo apply: columns written directly exist in the migrations', () => {
  for (const [table, cols] of Object.entries(WRITES)) {
    it(table, () => {
      const missing = cols.filter((c) => !mentioned(table, c))
      expect(missing).toEqual([])
    })
  }
})
