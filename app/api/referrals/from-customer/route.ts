import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import {
  canAccessCustomerRecordsFromPermissionNames,
  canEditCustomerRecordsFromPermissionNames,
} from '@/lib/permissions'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { isReferralLinkTargetType, referralLinkColumns } from '@/lib/referral-links'

export const dynamic = 'force-dynamic'

/**
 * Create/update a referral from the customer file.
 *
 * These were browser-client writes, which put them behind the anon-key session: if the
 * cookie session was not applied the insert reached Postgres unauthenticated and failed
 * on RLS. Going through the server uses the same cookie path as the rest of the app and
 * writes with the service client after an explicit permission check.
 *
 * Payout fields (status, paid_at, payment_method, install_date) are deliberately not
 * accepted here -- those stay with the manager-only flows.
 */
const EDITABLE_FIELDS = [
  'referred_name',
  'referred_email',
  'referred_phone',
  'referred_address',
  'referred_notes',
  'bonus_amount',
  'bonus_type',
] as const

type EditableField = (typeof EDITABLE_FIELDS)[number]

function pickEditableFields(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of EDITABLE_FIELDS) {
    if (!(field in body)) continue
    const value = body[field]
    if (field === 'bonus_amount') {
      const amount = Number(value)
      out[field] = Number.isFinite(amount) && amount >= 0 ? amount : 0
      continue
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      out[field] = trimmed === '' ? null : trimmed
      continue
    }
    if (value === null) out[field] = null
  }
  return out
}

async function authorize() {
  const supabase = createClient()
  const adminClient = createServiceClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'Your session has expired — sign in again.' }, { status: 401 }) }
  }

  const { data: profile } = await adminClient
    .from('users')
    .select('org_id, role, custom_role_id')
    .eq('id', user.id)
    .single()

  if (!profile?.org_id) {
    return { error: NextResponse.json({ error: 'User profile not found' }, { status: 404 }) }
  }

  const permissions = await resolveEffectivePermissionNames(adminClient, user.id, profile)
  return { adminClient, orgId: profile.org_id as string, userId: user.id, permissions }
}

/** Resolves the optional link payload into the single column the DB trigger expands. */
function resolveLinkColumns(body: Record<string, unknown>): Record<string, string> | null {
  const link = body.link as { target_type?: unknown; target_id?: unknown } | undefined
  if (!link) return null
  if (!isReferralLinkTargetType(link.target_type) || typeof link.target_id !== 'string' || !link.target_id) {
    return null
  }
  return referralLinkColumns({ type: link.target_type, id: link.target_id }) as Record<string, string>
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authorize()
    if ('error' in auth) return auth.error
    const { adminClient, orgId, userId, permissions } = auth

    // Matches who 028's org-wide INSERT policy already allowed: anyone on the customer file.
    if (!canAccessCustomerRecordsFromPermissionNames(permissions)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const referrerCustomerId = body.referrer_customer_id

    if (typeof referrerCustomerId !== 'string' || !referrerCustomerId) {
      return NextResponse.json({ error: 'referrer_customer_id is required' }, { status: 400 })
    }

    const fields = pickEditableFields(body)
    if (!fields.referred_name) {
      return NextResponse.json({ error: 'Referred person name is required' }, { status: 400 })
    }

    const { data: referrer } = await adminClient
      .from('customers')
      .select('id, name')
      .eq('id', referrerCustomerId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (!referrer) {
      return NextResponse.json({ error: 'Referring customer not found in this org' }, { status: 404 })
    }

    const link = resolveLinkColumns(body)
    if (link?.referred_customer_id === referrerCustomerId) {
      return NextResponse.json(
        { error: 'A customer cannot be linked as their own referral' },
        { status: 400 }
      )
    }

    const { data: referral, error } = await adminClient
      .from('referrals')
      .insert({
        org_id: orgId,
        referrer_customer_id: referrerCustomerId,
        referrer_name: referrer.name,
        created_by: userId,
        bonus_type: 'cash',
        ...fields,
        ...(link ?? {}),
      })
      .select('*')
      .single()

    if (error) {
      console.error('Referral create error:', error)
      return NextResponse.json({ error: `Failed to create referral: ${error.message}` }, { status: 400 })
    }

    return NextResponse.json({ referral })
  } catch (error) {
    console.error('Referral create API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create referral' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await authorize()
    if ('error' in auth) return auth.error
    const { adminClient, orgId, permissions } = auth

    if (!canEditCustomerRecordsFromPermissionNames(permissions)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const referralId = body.id

    if (typeof referralId !== 'string' || !referralId) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const fields = pickEditableFields(body)
    const link = resolveLinkColumns(body)

    if (Object.keys(fields).length === 0 && !link) {
      return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 })
    }
    if ('referred_name' in fields && !fields.referred_name) {
      return NextResponse.json({ error: 'Referred person name is required' }, { status: 400 })
    }

    const { data: existing } = await adminClient
      .from('referrals')
      .select('id, referrer_customer_id')
      .eq('id', referralId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (!existing) {
      return NextResponse.json({ error: 'Referral not found' }, { status: 404 })
    }
    if (link?.referred_customer_id === existing.referrer_customer_id) {
      return NextResponse.json(
        { error: 'A customer cannot be linked as their own referral' },
        { status: 400 }
      )
    }

    const { data: referral, error } = await adminClient
      .from('referrals')
      .update({ ...fields, ...(link ?? {}) })
      .eq('id', referralId)
      .eq('org_id', orgId)
      .select('*')
      .single()

    if (error) {
      console.error('Referral update error:', error)
      return NextResponse.json({ error: `Failed to update referral: ${error.message}` }, { status: 400 })
    }

    return NextResponse.json({ referral })
  } catch (error) {
    console.error('Referral update API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update referral' },
      { status: 500 }
    )
  }
}
