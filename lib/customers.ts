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
  return phone.replace(/\D/g, '').slice(-10)
}

function normalizeString(str: string | null | undefined): string {
  if (!str) return ''
  return str.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Find or create a customer record.
 * 
 * Matching priority:
 * 1. org_id + email (if email provided)
 * 2. org_id + phone (if phone provided, normalized to last 10 digits)
 * 3. org_id + normalized(name + address) for fuzzy match
 * 
 * If found: update any missing fields (address/phone/email)
 * If not found: create new customer
 */
export async function upsertCustomer(
  supabase: SupabaseClient,
  orgId: string,
  data: CustomerData
): Promise<UpsertResult> {
  const { name, email, phone, address_text } = data
  const normalizedPhone = normalizePhone(phone)
  
  let existingCustomer: any = null

  // Try to find by email first
  if (email) {
    const { data: byEmail } = await supabase
      .from('customers')
      .select('*')
      .eq('org_id', orgId)
      .ilike('email', email)
      .limit(1)
      .single()
    
    if (byEmail) existingCustomer = byEmail
  }

  // Try to find by phone if no email match
  if (!existingCustomer && normalizedPhone && normalizedPhone.length === 10) {
    const { data: customers } = await supabase
      .from('customers')
      .select('*')
      .eq('org_id', orgId)
      .not('phone', 'is', null)
    
    if (customers) {
      existingCustomer = customers.find(c => normalizePhone(c.phone) === normalizedPhone)
    }
  }

  // Try fuzzy match by name + address if still no match
  if (!existingCustomer && name && address_text) {
    const searchKey = normalizeString(name) + normalizeString(address_text)
    
    const { data: customers } = await supabase
      .from('customers')
      .select('*')
      .eq('org_id', orgId)
    
    if (customers) {
      existingCustomer = customers.find(c => {
        const customerKey = normalizeString(c.name) + normalizeString(c.address_text)
        return customerKey === searchKey
      })
    }
  }

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
      enqueueCustomerUpserted(supabase, orgId, existingCustomer.id, {
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
  enqueueCustomerUpserted(supabase, orgId, newCustomer.id, {
    name,
    email,
    phone,
    address_text,
  }).catch(err => console.error('Failed to enqueue customer event:', err))

  return { customer_id: newCustomer.id, created: true }
}
