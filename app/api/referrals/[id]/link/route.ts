import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { canEditCustomerRecordsFromPermissionNames } from '@/lib/permissions'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import {
  isReferralLinkTargetType,
  referralLinkColumns,
  referralUnlinkColumns,
  type ReferralLinkTargetType,
} from '@/lib/referral-links'

export const dynamic = 'force-dynamic'

const TARGET_TABLES: Record<ReferralLinkTargetType, { table: string; nameColumn: string }> = {
  opportunity: { table: 'opportunities', nameColumn: 'address_text' },
  customer: { table: 'customers', nameColumn: 'name' },
  lead: { table: 'leads', nameColumn: 'homeowner_name' },
}

async function authorize(request: NextRequest) {
  const supabase = createClient()
  const adminClient = createServiceClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
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
  if (!canEditCustomerRecordsFromPermissionNames(permissions)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { adminClient, userId: user.id, orgId: profile.org_id as string }
}

/** Loads the referral and proves it belongs to the caller's org before any write. */
async function loadReferral(
  adminClient: ReturnType<typeof createServiceClient>,
  referralId: string,
  orgId: string
) {
  const { data } = await adminClient
    .from('referrals')
    .select(
      'id, org_id, referrer_customer_id, referred_name, referred_email, referred_phone, referred_address, referred_notes, referred_lead_id, referred_opportunity_id, referred_customer_id, status'
    )
    .eq('id', referralId)
    .eq('org_id', orgId)
    .maybeSingle()

  return data
}

// POST - attach an existing record, or create a lead from the referral and attach that
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await authorize(request)
    if ('error' in auth) return auth.error
    const { adminClient, orgId, userId } = auth

    const referral = await loadReferral(adminClient, params.id, orgId)
    if (!referral) {
      return NextResponse.json({ error: 'Referral not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))

    // --- Convert: no record exists yet, so make the lead this referral becomes ---
    if (body?.create_lead === true) {
      if (referral.referred_lead_id) {
        return NextResponse.json(
          { error: 'This referral is already linked to a lead' },
          { status: 409 }
        )
      }

      const { data: lead, error: leadError } = await adminClient
        .from('leads')
        .insert({
          org_id: orgId,
          owner_user_id: userId,
          status: 'new',
          source: 'referral',
          homeowner_name: referral.referred_name,
          phone: referral.referred_phone,
          email: referral.referred_email,
          address_text: referral.referred_address,
          notes: referral.referred_notes,
        })
        .select('id, homeowner_name')
        .single()

      if (leadError || !lead) {
        console.error('Referral lead creation error:', leadError)
        return NextResponse.json(
          { error: `Failed to create lead: ${leadError?.message ?? 'unknown error'}` },
          { status: 400 }
        )
      }

      const { data: linked, error: linkError } = await adminClient
        .from('referrals')
        .update({ referred_lead_id: lead.id })
        .eq('id', referral.id)
        .eq('org_id', orgId)
        .select('*')
        .single()

      if (linkError) {
        // The lead exists but is unattached — say so rather than reporting a clean failure.
        console.error('Referral link-after-create error:', linkError)
        return NextResponse.json(
          {
            error: `Lead ${lead.id} was created but could not be linked: ${linkError.message}`,
            lead_id: lead.id,
          },
          { status: 500 }
        )
      }

      return NextResponse.json({ referral: linked, created_lead_id: lead.id })
    }

    // --- Attach an existing record ---
    const targetType = body?.target_type
    const targetId = body?.target_id

    if (!isReferralLinkTargetType(targetType) || typeof targetId !== 'string' || !targetId) {
      return NextResponse.json(
        { error: 'target_type (opportunity|customer|lead) and target_id are required' },
        { status: 400 }
      )
    }

    if (targetType === 'customer' && targetId === referral.referrer_customer_id) {
      return NextResponse.json(
        { error: 'A customer cannot be linked as their own referral' },
        { status: 400 }
      )
    }

    const { table } = TARGET_TABLES[targetType]
    const { data: target } = await adminClient
      .from(table)
      .select('id')
      .eq('id', targetId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (!target) {
      return NextResponse.json({ error: `${targetType} not found in this org` }, { status: 404 })
    }

    // Replace any prior link so switching targets can't leave stale ids behind; the
    // DB trigger then derives the remaining columns from the new pick.
    const { data: updated, error: updateError } = await adminClient
      .from('referrals')
      .update({ ...referralUnlinkColumns(), ...referralLinkColumns({ id: targetId, type: targetType }) })
      .eq('id', referral.id)
      .eq('org_id', orgId)
      .select('*')
      .single()

    if (updateError) {
      console.error('Referral link error:', updateError)
      return NextResponse.json({ error: `Failed to link referral: ${updateError.message}` }, { status: 400 })
    }

    return NextResponse.json({ referral: updated })
  } catch (error) {
    console.error('Referral link API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to link referral' },
      { status: 500 }
    )
  }
}

// DELETE - detach the referral from every record, leaving the typed details intact
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = await authorize(request)
    if ('error' in auth) return auth.error
    const { adminClient, orgId } = auth

    const referral = await loadReferral(adminClient, params.id, orgId)
    if (!referral) {
      return NextResponse.json({ error: 'Referral not found' }, { status: 404 })
    }

    // Unlinking undoes the auto-qualify, but never rewrites a payout that already
    // happened or a status a manager set further along.
    const nextStatus = referral.status === 'qualified' ? 'pending' : referral.status

    const { data: updated, error: updateError } = await adminClient
      .from('referrals')
      .update({ ...referralUnlinkColumns(), status: nextStatus })
      .eq('id', referral.id)
      .eq('org_id', orgId)
      .select('*')
      .single()

    if (updateError) {
      console.error('Referral unlink error:', updateError)
      return NextResponse.json({ error: `Failed to unlink referral: ${updateError.message}` }, { status: 400 })
    }

    return NextResponse.json({ referral: updated })
  } catch (error) {
    console.error('Referral unlink API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to unlink referral' },
      { status: 500 }
    )
  }
}
