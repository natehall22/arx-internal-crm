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
 * Read/create/update referrals from the customer file.
 *
 * These were browser-client calls against Supabase directly. Writes failed loudly
 * (RLS rejects with 42501) when the cookie session was not applied, but a blocked
 * SELECT returns zero rows with no error at all -- so a stale session made this list
 * look like "no referrals yet" even after a save had genuinely succeeded elsewhere.
 * Confirmed live: two referral rows existed, correctly linked, while the tab still
 * rendered empty. Routing every operation through the server closes both failure
 * modes the same way -- one cookie path, one permission check, done once.
 *
 * Payout fields (status, paid_at, payment_method, install_date) are deliberately not
 * accepted by POST/PATCH here -- those go through /api/referrals/[id]/status instead,
 * which is gated to REFERRAL_MANAGER_ROLES rather than customers:edit.
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

// GET - the referrals list for a customer or project, plus the org's default bonus
export async function GET(request: NextRequest) {
  try {
    const auth = await authorize()
    if ('error' in auth) return auth.error
    const { adminClient, orgId, permissions } = auth

    // Matches the page-level gate in app/customers/[id]/page.tsx: anyone who can open
    // the customer file can see its referrals.
    if (!canAccessCustomerRecordsFromPermissionNames(permissions)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const customerId = request.nextUrl.searchParams.get('customer_id')
    const projectId = request.nextUrl.searchParams.get('project_id')

    let query = adminClient
      .from('referrals')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })

    if (customerId) {
      // Referrals made BY this customer, and referrals OF this customer.
      query = query.or(`referrer_customer_id.eq.${customerId},referred_customer_id.eq.${customerId}`)
    }
    if (projectId) {
      query = query.eq('referred_project_id', projectId)
    }

    const [{ data: referrals, error }, { data: org }] = await Promise.all([
      query,
      adminClient.from('orgs').select('settings').eq('id', orgId).single(),
    ])

    if (error) {
      console.error('Referrals list error:', error)
      return NextResponse.json({ error: `Failed to load referrals: ${error.message}` }, { status: 400 })
    }

    const defaultBonusRaw = (org?.settings as { referral_bonus?: unknown } | null)?.referral_bonus
    const defaultBonus = Number.isFinite(Number(defaultBonusRaw)) ? Number(defaultBonusRaw) : 100

    return NextResponse.json({ referrals: referrals || [], default_bonus: defaultBonus })
  } catch (error) {
    console.error('Referrals list API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load referrals' },
      { status: 500 }
    )
  }
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
