import { SupabaseClient } from '@supabase/supabase-js'
import { enqueueCustomerUpserted } from './integrations'

interface CustomerData {
  name: string
  email?: string | null
  phone?: string | null
  address_text?: string | null
}

/**
 * Non-empty name for customer create/upsert when the lead/contract omits a formal name.
 */
export function resolveCustomerDisplayName(opts: {
  name?: string | null
  address_text?: string | null
  phone?: string | null
  /** e.g. first 8 chars of lead id */
  fallbackIdHint?: string | null
}): string {
  const n = (opts.name || '').trim()
  if (n) return n
  const firstLine = (opts.address_text || '').split(',')[0]?.trim()
  if (firstLine) return firstLine
  const digits = (opts.phone || '').replace(/\D/g, '')
  if (digits.length >= 4) return `Customer (${digits.slice(-4)})`
  if (opts.fallbackIdHint) return `Customer ${opts.fallbackIdHint}`
  return 'Customer'
}

interface UpsertResult {
  customer_id: string
  created: boolean
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const last10 = phone.replace(/\D/g, '').slice(-10)
  // Filler numbers (0000000000, 5555555555, 1234567890) are not an identity: never merge two people on them.
  if (last10.length === 10 && (/^(\d)\1{9}$/.test(last10) || last10 === '1234567890' || last10 === '0123456789')) return null
  return last10
}

function normalizeString(str: string | null | undefined): string {
  if (!str) return ''
  return str.toLowerCase().replace(/[^a-z0-9]/g, '')
}

const PLACEHOLDER_IDENTITY_EMAILS = new Set([
  'none@none.com',
  'noemail@noemail.com',
  'noemail@example.com',
])

export function normalizeIdentityEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase()
  if (!normalized) return null
  if (PLACEHOLDER_IDENTITY_EMAILS.has(normalized)) return null
  return normalized
}

/**
 * Read-only: the existing customer a person/address maps to (real email, then last-10 phone, then exact
 * name+address). The one matching rule — `upsertCustomer`, the opportunity auto-link and the orphan backfill
 * all use it, so a dry run shows exactly what a real run would do.
 */
export async function findExistingCustomer(
  supabase: SupabaseClient,
  orgId: string,
  data: CustomerData
): Promise<any | null> {
  const { name, email, phone, address_text } = data
  const identityEmail = normalizeIdentityEmail(email)
  const normalizedPhone = normalizePhone(phone)
  let existingCustomer: any = null

  // Try to find by real email first. Placeholder emails like none@none.com are common
  // source-system fillers and should not be treated as customer identity.
  if (identityEmail) {
    const { data: byEmail } = await supabase
      .from('customers')
      .select('*')
      .eq('org_id', orgId)
      .ilike('email', identityEmail)
      .limit(1)
      .single()
    
    if (byEmail) existingCustomer = byEmail
  }

  // Try to find by normalized phone if no email match.
  // We store the raw phone but match by stripping non-digits; filter in DB using LIKE on last 10 digits.
  if (!existingCustomer && normalizedPhone && normalizedPhone.length === 10) {
    const { data: byPhone } = await supabase
      .from('customers')
      .select('*')
      .eq('org_id', orgId)
      .like('phone', `%${normalizedPhone}`)
      .limit(5)

    if (byPhone) {
      existingCustomer = byPhone.find((c: any) => normalizePhone(c.phone) === normalizedPhone) ?? null
    }
  }

  // Try fuzzy match by name + address if still no match.
  // Use DB-side filtering with ilike to avoid a full-table scan.
  if (!existingCustomer && name && address_text) {
    const namePart = name.trim().slice(0, 40)
    const addrPart = address_text.trim().split(',')[0]?.slice(0, 40) ?? ''
    const { data: candidates } = await supabase
      .from('customers')
      .select('*')
      .eq('org_id', orgId)
      .ilike('name', `%${namePart}%`)
      .ilike('address_text', `%${addrPart}%`)
      .limit(10)

    if (candidates) {
      const searchKey = normalizeString(name) + normalizeString(address_text)
      existingCustomer =
        candidates.find((c: any) => {
          const customerKey = normalizeString(c.name) + normalizeString(c.address_text)
          return customerKey === searchKey
        }) ?? null
    }
  }

  return existingCustomer
}

/**
 * Find or create a customer record.
 * 
 * Matching priority:
 * 1. org_id + email (if a real email is provided)
 * 2. org_id + phone (if phone provided, normalized to last 10 digits)
 * 3. org_id + normalized(name + address) for fuzzy match
 * 
 * If found: update any missing fields (address/phone/email)
 * If not found: create new customer
 */
export async function upsertCustomer(
  supabase: SupabaseClient,
  orgId: string,
  data: CustomerData,
  opts: { skipIntegrations?: boolean } = {}
): Promise<UpsertResult> {
  const { name, email, phone, address_text } = data
  const existingCustomer = await findExistingCustomer(supabase, orgId, data)

  // If found, update missing fields
  if (existingCustomer) {
    const updates: Record<string, any> = {}
    
    if (!existingCustomer.email && email) updates.email = email
    if (!existingCustomer.phone && phone) updates.phone = phone
    if (!existingCustomer.address_text && address_text) updates.address_text = address_text
    if (!existingCustomer.name && name) updates.name = name
    
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString()
      await supabase
        .from('customers')
        .update(updates)
        .eq('id', existingCustomer.id)
      
      // Enqueue integration event for customer update
      if (!opts.skipIntegrations) enqueueCustomerUpserted(supabase, orgId, existingCustomer.id, {
        ...existingCustomer,
        ...updates,
      }).catch(err => console.error('Failed to enqueue customer event:', err))
    }
    
    return { customer_id: existingCustomer.id, created: false }
  }

  // Create new customer
  const { data: newCustomer, error } = await supabase
    .from('customers')
    .insert({
      org_id: orgId,
      name: name || null,
      email: email || null,
      phone: phone || null,
      address_text: address_text || null,
    })
    .select('id')
    .single()

  if (error || !newCustomer) {
    throw new Error(`Failed to create customer: ${error?.message || 'Unknown error'}`)
  }

  // Enqueue integration event for new customer
  if (!opts.skipIntegrations) enqueueCustomerUpserted(supabase, orgId, newCustomer.id, {
    name,
    email,
    phone,
    address_text,
  }).catch(err => console.error('Failed to enqueue customer event:', err))

  return { customer_id: newCustomer.id, created: true }
}

/**
 * At contract signing the customer row already exists (it is created when the inspection is booked): fill whatever the
 * signed contract knows and the row lacks (email, phone, address), then tell QuickBooks — the one moment it hears about a
 * customer. Never overwrites a value that is already there. Best-effort: a failure here must not block signing.
 */
export async function enrichCustomerFromContract(
  supabase: SupabaseClient,
  orgId: string,
  customerId: string,
  contract: { customer_name?: string | null; customer_email?: string | null; customer_phone?: string | null; project_address?: string | null }
): Promise<void> {
  try {
    const { data: existing } = await supabase.from('customers').select('*').eq('id', customerId).eq('org_id', orgId).maybeSingle()
    if (!existing) return
    const updates: Record<string, string> = {}
    const email = normalizeIdentityEmail(contract.customer_email)
    if (!existing.email && email) updates.email = email
    if (!existing.phone && contract.customer_phone?.trim()) updates.phone = contract.customer_phone.trim()
    if (!existing.address_text && contract.project_address?.trim()) updates.address_text = contract.project_address.trim()
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString()
      await supabase.from('customers').update(updates).eq('id', customerId)
    }
    await enqueueCustomerUpserted(supabase, orgId, customerId, { ...existing, ...updates })
  } catch (e) {
    console.error('enrichCustomerFromContract failed:', e)
  }
}
