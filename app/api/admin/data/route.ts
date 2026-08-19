import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { compPlanBodyChanged, COMP_PLAN_VERSION_FLOOR_DATE } from '@/lib/comp-plan-version'
import { getEasternTodayIso } from '@/lib/eastern-datetime'

export const dynamic = 'force-dynamic'

function easternDateToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

async function getAuthenticatedUser(_req: NextRequest) {
  try {
    const { authUser: user, profile } = await requireAuthApi()
    const adminClient = createServiceClient()
    const isAdmin = ['admin', 'regional_manager', 'sales_manager'].includes(profile.role)
    return { user, profile, adminClient, isAdmin }
  } catch {
    return { error: 'Unauthorized', status: 401 }
  }
}

// GET - Fetch admin data
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request)
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { profile, adminClient, isAdmin } = auth
    const { searchParams } = new URL(request.url)
    const resource = searchParams.get('resource')

    if (!isAdmin && !(resource === 'comp_plans' && isPayrollAdminRole(profile.role))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Regions
    if (resource === 'regions') {
      const { data, error } = await adminClient
        .from('regions')
        .select('*, teams(*)')
        .eq('org_id', profile.org_id)
        .order('name')

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ regions: data || [] })
    }

    // Teams
    if (resource === 'teams') {
      const regionId = searchParams.get('region_id')
      let query = adminClient
        .from('teams')
        .select('*, regions(*)')
        .eq('org_id', profile.org_id)
        .order('name')

      if (regionId) {
        query = query.eq('region_id', regionId)
      }

      const { data: teams, error } = await query

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      // Get members for each team
      const teamsWithMembers = []
      for (const team of teams || []) {
        const { data: members } = await adminClient
          .from('users')
          .select('*')
          .eq('team_id', team.id)
          .eq('active', true)
          .order('full_name')

        teamsWithMembers.push({
          ...team,
          members: members || []
        })
      }

      // Also get regions for the form
      const { data: regions } = await adminClient
        .from('regions')
        .select('*')
        .eq('org_id', profile.org_id)
        .order('name')

      return NextResponse.json({ teams: teamsWithMembers, regions: regions || [] })
    }

    // Comp Plans
    if (resource === 'comp_plans') {
      const { data: plans, error: plansError } = await adminClient
        .from('comp_plans')
        .select('*')
        .eq('org_id', profile.org_id)
        .order('created_at', { ascending: false })

      const { data: assignments, error: assignmentsError } = await adminClient
        .from('user_comp_plans')
        .select('*, users(full_name, role), comp_plans(name)')
        .eq('org_id', profile.org_id)
        .order('effective_from', { ascending: false })

      const { data: overlayAssignments, error: overlayAssignmentsError } = await adminClient
        .from('user_management_comp_overlay_assignments')
        .select('id, user_id, comp_plan_id, lane, effective_from, effective_to, ended_at, end_reason, comp_plans(name)')
        .eq('org_id', profile.org_id)
        .is('cancelled_at', null)
        .order('effective_from', { ascending: false })

      const { data: overlayVersions, error: overlayVersionsError } = await adminClient
        .from('management_comp_overlay_plan_versions')
        .select('id, comp_plan_id, lane, override_percent, effective_from')
        .eq('org_id', profile.org_id)
        .order('effective_from', { ascending: false })

      // Plan term history — what each plan paid, from when, changed by whom and why.
      // No `users` embed here: created_by_user_id is half of a COMPOSITE foreign key
      // (org_id, created_by_user_id), and the page already has the user list to resolve
      // a name against. An embed on a composite FK is the kind of thing that works until
      // it silently 500s this whole payload.
      const { data: planVersions, error: planVersionsError } = await adminClient
        .from('comp_plan_versions')
        .select(
          'id, comp_plan_id, effective_from, plan_type, base_percentage, flat_amount, hourly_rate, unit_rate, unit_type, tiers, volume_bonuses, is_manager_plan, change_reason, created_at, created_by_user_id'
        )
        .eq('org_id', profile.org_id)
        .order('effective_from', { ascending: false })

      const { data: users, error: usersError } = await adminClient
        .from('users')
        .select('id, full_name, email, role, manager_user_id, region_id, team_id')
        .eq('org_id', profile.org_id)
        .eq('active', true)
        .order('full_name')

      const { data: managerAssignments, error: managerAssignmentsError } = await adminClient
        .from('user_manager_assignments')
        .select('id, user_id, manager_user_id, effective_from, effective_to')
        .eq('org_id', profile.org_id)
        .order('effective_from', { ascending: true })

      const loadError =
        plansError ||
        assignmentsError ||
        overlayAssignmentsError ||
        overlayVersionsError ||
        planVersionsError ||
        usersError ||
        managerAssignmentsError
      if (loadError) {
        return NextResponse.json({ error: loadError.message }, { status: 500 })
      }

      return NextResponse.json({
        compPlans: plans || [],
        userAssignments: assignments || [],
        managementOverlayAssignments: overlayAssignments || [],
        managementOverlayVersions: overlayVersions || [],
        compPlanVersions: planVersions || [],
        managerAssignments: managerAssignments || [],
        users: users || []
      })
    }

    // Users
    if (resource === 'users') {
      const { data: users, error } = await adminClient
        .from('users')
        .select('*, teams(name), regions(name)')
        .eq('org_id', profile.org_id)
        .order('full_name')

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      const { data: teams } = await adminClient
        .from('teams')
        .select('*')
        .eq('org_id', profile.org_id)
        .order('name')

      const { data: regions } = await adminClient
        .from('regions')
        .select('*')
        .eq('org_id', profile.org_id)
        .order('name')

      return NextResponse.json({ 
        users: users || [], 
        teams: teams || [],
        regions: regions || []
      })
    }

    // Campaigns
    if (resource === 'campaigns') {
      const { data: campaigns, error } = await adminClient
        .from('campaigns')
        .select('*')
        .eq('org_id', profile.org_id)
        .order('created_at', { ascending: false })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ campaigns: campaigns || [] })
    }

    // Scheduling
    if (resource === 'scheduling') {
      const { data: schedules, error } = await adminClient
        .from('schedules')
        .select('*, users(full_name)')
        .eq('org_id', profile.org_id)
        .order('created_at', { ascending: false })

      if (error && !error.message.includes('does not exist')) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ schedules: schedules || [] })
    }

    // Subs/Subcontractors
    if (resource === 'subs') {
      const { data: subs, error } = await adminClient
        .from('subcontractors')
        .select('*')
        .eq('org_id', profile.org_id)
        .order('name')

      if (error && !error.message.includes('does not exist')) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ subs: subs || [] })
    }

    // Dashboard Settings
    if (resource === 'dashboard_settings') {
      const { data: org } = await adminClient
        .from('orgs')
        .select('settings')
        .eq('id', profile.org_id)
        .single()

      return NextResponse.json({ 
        dashboardSettings: org?.settings?.dashboard || {},
        orgId: profile.org_id
      })
    }

    // Proposals/Templates
    if (resource === 'proposals') {
      const { data: templates, error } = await adminClient
        .from('proposal_templates')
        .select('*')
        .eq('org_id', profile.org_id)
        .order('name')

      if (error && !error.message.includes('does not exist')) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ templates: templates || [] })
    }

    return NextResponse.json({ error: 'Invalid resource' }, { status: 400 })
  } catch (error) {
    console.error('Admin data API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to load data' 
    }, { status: 500 })
  }
}

// POST - Create admin data
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request)
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = await request.json()
    const { resource, ...data } = body
    const { profile, adminClient, isAdmin } = auth

    if (!isAdmin && !(['comp_plan', 'user_comp_plan'].includes(resource) && isPayrollAdminRole(profile.role))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Create Region
    if (resource === 'region') {
      const { error } = await adminClient
        .from('regions')
        .insert({ name: data.name, org_id: profile.org_id })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Create Team
    if (resource === 'team') {
      const { error } = await adminClient
        .from('teams')
        .insert({ 
          name: data.name, 
          org_id: profile.org_id,
          region_id: data.region_id || null,
          timezone: data.timezone || 'America/New_York'
        })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Create Comp Plan
    if (resource === 'comp_plan') {
      if (!isPayrollAdminRole(profile.role)) {
        return NextResponse.json({ error: 'Payroll administrator access required' }, { status: 403 })
      }
      const basePercentage = data.base_percentage === null || data.base_percentage === undefined || data.base_percentage === ''
        ? null
        : Number(data.base_percentage)
      if (data.plan_purpose === 'management_overlay' && (basePercentage === null || !Number.isFinite(basePercentage) || basePercentage < 0 || basePercentage > 100)) {
        return NextResponse.json({ error: 'Management overlay rate must be between 0 and 100' }, { status: 400 })
      }
      const planData = {
        org_id: profile.org_id,
        name: data.name,
        description: data.description || null,
        plan_type: data.plan_type,
        flat_amount: data.flat_amount || null,
        base_percentage: basePercentage,
        hourly_rate: data.hourly_rate || null,
        unit_rate: data.unit_rate || null,
        unit_type: data.unit_type || null,
        hybrid_components: data.hybrid_components || null,
        tiers: data.tiers || null,
        volume_bonuses: data.volume_bonuses || null,
        is_manager_plan: data.is_manager_plan || false,
        personal_sales_enabled: data.personal_sales_enabled,
        team_override_enabled: data.team_override_enabled || false,
        team_overrides: data.team_overrides || null,
        applicable_roles: data.applicable_roles || ['sales_rep', 'canvasser'],
        is_active: data.is_active ?? true,
        is_default: data.is_default || false,
        readme: data.readme || null,
        plan_purpose: data.plan_purpose === 'management_overlay' ? 'management_overlay' : 'primary',
      }

      const { data: createdPlan, error } = await adminClient
        .from('comp_plans')
        .insert(planData)
        .select('id')
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      // Seed the plan's first version, open-ended into the past like the migration's
      // backfill. Without it the plan has no terms on record before its first
      // amendment, and the resolver's fallback would hand those earlier jobs the
      // AMENDED plan row — restating pay for sales made under the original terms.
      if (createdPlan?.id) {
        const { error: seedError } = await adminClient.from('comp_plan_versions').insert({
          org_id: profile.org_id,
          comp_plan_id: createdPlan.id,
          effective_from: COMP_PLAN_VERSION_FLOOR_DATE,
          plan_type: planData.plan_type,
          base_percentage: planData.base_percentage,
          flat_amount: planData.flat_amount,
          hourly_rate: planData.hourly_rate,
          unit_rate: planData.unit_rate,
          unit_type: planData.unit_type,
          hybrid_components: planData.hybrid_components,
          tiers: planData.tiers,
          volume_bonuses: planData.volume_bonuses,
          team_overrides: planData.team_overrides,
          is_manager_plan: planData.is_manager_plan,
          personal_sales_enabled: planData.personal_sales_enabled,
          team_override_enabled: planData.team_override_enabled,
          created_by_user_id: profile.id,
          change_reason: 'Initial terms recorded when the plan was created',
        })
        if (seedError) {
          // A plan with no version is a restatement waiting to happen, so don't leave
          // one behind: remove the plan and make the admin retry.
          console.error('comp_plan create: initial version failed, rolling back plan', seedError)
          await adminClient.from('comp_plans').delete().eq('id', createdPlan.id).eq('org_id', profile.org_id)
          return NextResponse.json(
            { error: 'Could not record the plan\'s initial pay terms. The plan was not created.' },
            { status: 500 }
          )
        }
      }

      // If setting as default, unset other defaults
      if (data.is_default) {
        await adminClient
          .from('comp_plans')
          .update({ is_default: false })
          .eq('org_id', profile.org_id)
          .neq('name', data.name)
      }

      return NextResponse.json({ success: true })
    }

    // Assign Comp Plan to User
    if (resource === 'user_comp_plan') {
      if (!isPayrollAdminRole(profile.role)) {
        return NextResponse.json({ error: 'Payroll administrator access required' }, { status: 403 })
      }
      const reason = typeof data.change_reason === 'string' ? data.change_reason.trim() : ''
      if (!reason) {
        return NextResponse.json({ error: 'A change reason is required for payroll history' }, { status: 400 })
      }
      const { error } = await adminClient.rpc('assign_primary_comp_plan', {
        p_org_id: profile.org_id,
        p_user_id: data.user_id,
        p_comp_plan_id: data.comp_plan_id,
        p_effective_from: data.effective_from,
        p_override_percentage: data.override_percentage ?? null,
        p_created_by_user_id: auth.user.id,
        p_change_reason: reason,
      })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Create Campaign
    if (resource === 'campaign') {
      const { error } = await adminClient
        .from('campaigns')
        .insert({ ...data, org_id: profile.org_id })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Create Subcontractor
    if (resource === 'sub') {
      const { error } = await adminClient
        .from('subcontractors')
        .insert({ ...data, org_id: profile.org_id })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Create Proposal Template
    if (resource === 'proposal_template') {
      const { error } = await adminClient
        .from('proposal_templates')
        .insert({ ...data, org_id: profile.org_id })

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid resource' }, { status: 400 })
  } catch (error) {
    console.error('Admin data API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to create' 
    }, { status: 500 })
  }
}

// PATCH - Update admin data
export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request)
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = await request.json()
    const { resource, id, ...data } = body
    const { profile, adminClient, isAdmin } = auth

    if (!isAdmin && !(resource === 'comp_plan' && isPayrollAdminRole(profile.role))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Update Region
    if (resource === 'region') {
      const { error } = await adminClient
        .from('regions')
        .update({ name: data.name })
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Update Team
    if (resource === 'team') {
      const { error } = await adminClient
        .from('teams')
        .update({ 
          name: data.name,
          region_id: data.region_id || null,
          timezone: data.timezone || 'America/New_York'
        })
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Update Comp Plan
    //
    // Identity (name, description, roles, readme, active/default) is edited in place —
    // none of it changes anyone's pay. The BODY (rates, tiers, volume bonuses,
    // is_manager_plan) is versioned: an edit adds an effective-dated row to
    // comp_plan_versions via amend_comp_plan_version, and payroll resolves the body on
    // each job's sale date. This replaces the old blanket 409 on assigned plans, which
    // protected paid history by making every plan in the system uneditable.
    if (resource === 'comp_plan') {
      if (!isPayrollAdminRole(profile.role)) {
        return NextResponse.json({ error: 'Payroll administrator access required' }, { status: 403 })
      }

      const { data: currentPlan, error: currentPlanError } = await adminClient
        .from('comp_plans')
        .select('*')
        .eq('id', id)
        .eq('org_id', profile.org_id)
        .maybeSingle()
      if (currentPlanError) {
        return NextResponse.json({ error: currentPlanError.message }, { status: 500 })
      }
      if (!currentPlan) {
        return NextResponse.json({ error: 'Comp plan not found' }, { status: 404 })
      }

      const basePercentage = data.base_percentage === null || data.base_percentage === undefined || data.base_percentage === ''
        ? null
        : Number(data.base_percentage)
      if (data.plan_purpose === 'management_overlay' && (basePercentage === null || !Number.isFinite(basePercentage) || basePercentage < 0 || basePercentage > 100)) {
        return NextResponse.json({ error: 'Management overlay rate must be between 0 and 100' }, { status: 400 })
      }

      const nextBody = {
        plan_type: data.plan_type,
        base_percentage: basePercentage,
        flat_amount: data.flat_amount || null,
        hourly_rate: data.hourly_rate || null,
        unit_rate: data.unit_rate || null,
        unit_type: data.unit_type || null,
        hybrid_components: data.hybrid_components || null,
        tiers: data.tiers || null,
        volume_bonuses: data.volume_bonuses || null,
        team_overrides: data.team_overrides || null,
        is_manager_plan: data.is_manager_plan || false,
        personal_sales_enabled: data.personal_sales_enabled,
        team_override_enabled: data.team_override_enabled || false,
      }

      // A management overlay plan's rate is NOT what pays. Override lines resolve from
      // management_comp_overlay_plan_versions, written per assignment, so editing the
      // plan body here would report success and change nobody's pay. The old blanket
      // 409 hid this by blocking the edit; now that plan bodies are editable, say so.
      if (
        currentPlan.plan_purpose === 'management_overlay' &&
        compPlanBodyChanged(currentPlan as Record<string, unknown>, nextBody)
      ) {
        return NextResponse.json(
          {
            error:
              'The override rate on a management overlay plan is set per manager, on the assignment itself — ' +
              'use "Set or change override" under Manager override. Editing it here would not change anyone\'s pay.',
            code: 'overlay_rate_not_editable_here',
          },
          { status: 400 }
        )
      }

      if (compPlanBodyChanged(currentPlan as Record<string, unknown>, nextBody)) {
        const effectiveFrom = typeof data.effective_from === 'string' ? data.effective_from : ''
        const changeReason = typeof data.change_reason === 'string' ? data.change_reason.trim() : ''
        if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
          return NextResponse.json(
            {
              error: 'Changing a plan\'s pay terms needs an effective date — earlier jobs keep the terms they were sold under.',
              code: 'effective_from_required',
            },
            { status: 400 }
          )
        }
        if (!changeReason) {
          return NextResponse.json(
            { error: 'A change reason is required for payroll history.', code: 'change_reason_required' },
            { status: 400 }
          )
        }

        // Settled pay is not editable. Precise test, matching the per-job override
        // guard: does this plan already have payout lines, in a locked or paid period,
        // on a job sold on or after the requested date? An old sale date on its own
        // proves nothing — materialization has no lower bound, so plenty of old jobs
        // have never been paid.
        const [{ data: settledLines, error: settledError }, { data: planAssignments, error: planAssignmentsError }] =
          await Promise.all([
            adminClient
              .from('payroll_payout_lines')
              .select('user_id, job:production_jobs!inner(id, job_number, sale_date), payroll_periods!inner(status)')
              .eq('org_id', profile.org_id)
              .in('payroll_periods.status', ['locked', 'paid'])
              .gte('production_jobs.sale_date', effectiveFrom),
            adminClient
              .from('user_comp_plans')
              .select('user_id, effective_from, effective_to')
              .eq('org_id', profile.org_id)
              .eq('comp_plan_id', id),
          ])
        if (settledError || planAssignmentsError) {
          console.error('comp_plan amend (settled check)', settledError || planAssignmentsError)
          return NextResponse.json({ error: 'Failed to check settled payroll' }, { status: 500 })
        }

        const assignmentsByUser = new Map<string, Array<{ from: string; to: string | null }>>()
        for (const row of (planAssignments || []) as Array<{ user_id: string; effective_from: string; effective_to: string | null }>) {
          const list = assignmentsByUser.get(row.user_id) || []
          list.push({ from: row.effective_from.slice(0, 10), to: row.effective_to ? row.effective_to.slice(0, 10) : null })
          assignmentsByUser.set(row.user_id, list)
        }

        const blocking = ((settledLines || []) as Array<Record<string, unknown>>).find((line) => {
          const job = (Array.isArray(line.job) ? line.job[0] : line.job) as { sale_date?: string; job_number?: string } | null
          const saleDate = job?.sale_date?.slice(0, 10)
          if (!saleDate || saleDate < effectiveFrom) return false
          return (assignmentsByUser.get(line.user_id as string) || []).some(
            (a) => a.from <= saleDate && (!a.to || a.to >= saleDate)
          )
        })
        if (blocking) {
          const job = (Array.isArray(blocking.job) ? blocking.job[0] : blocking.job) as { sale_date?: string; job_number?: string } | null
          return NextResponse.json(
            {
              error:
                `Job ${job?.job_number || 'unknown'} (sold ${job?.sale_date?.slice(0, 10)}) was already paid on this plan ` +
                `in a settled payroll period. An amendment effective ${effectiveFrom} would restate it. Choose a later date.`,
              code: 'settled_pay_conflict',
            },
            { status: 400 }
          )
        }

        // Backdating past today is legitimate (a ladder that went live before it was
        // entered) but must be deliberate, same as the org rate editor.
        const todayIso = getEasternTodayIso()
        if (effectiveFrom < todayIso && data.confirm_backdate !== true) {
          return NextResponse.json(
            {
              error:
                `${effectiveFrom} is in the past. Backdating changes what already-open payroll periods will pay ` +
                'for jobs sold on or after that date. Confirm to continue.',
              code: 'confirm_backdate_required',
            },
            { status: 400 }
          )
        }

        const { error: amendError } = await adminClient.rpc('amend_comp_plan_version', {
          p_org_id: profile.org_id,
          p_comp_plan_id: id,
          p_effective_from: effectiveFrom,
          p_body: nextBody,
          p_created_by_user_id: profile.id,
          p_change_reason: changeReason,
        })
        if (amendError) {
          return NextResponse.json({ error: amendError.message }, { status: 400 })
        }
      }

      // Identity only — the RPC owns every body column, and syncs them onto the plan
      // row itself when the amendment is already in effect.
      const { error } = await adminClient
        .from('comp_plans')
        .update({
          name: data.name,
          description: data.description || null,
          applicable_roles: data.applicable_roles || ['sales_rep', 'canvasser'],
          is_active: data.is_active ?? true,
          is_default: data.is_default || false,
          readme: data.readme || null,
          plan_purpose: data.plan_purpose === 'management_overlay' ? 'management_overlay' : 'primary',
        })
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      // If setting as default, unset other defaults
      if (data.is_default) {
        await adminClient
          .from('comp_plans')
          .update({ is_default: false })
          .eq('org_id', profile.org_id)
          .neq('id', id)
      }

      return NextResponse.json({ success: true })
    }

    // Update User (whitelist to prevent privilege escalation)
    if (resource === 'user') {
      const USER_ALLOWED = new Set([
        'full_name', 'email', 'phone', 'role', 'team_id', 'region_id',
        'manager_user_id', 'active', 'canvass_pin_visibility',
        'show_in_reports', 'can_receive_appointments', 'dashboard_view',
        'custom_role_id',
      ])
      const userUpdate: Record<string, unknown> = {}
      for (const key of Object.keys(data)) {
        if (USER_ALLOWED.has(key)) userUpdate[key] = data[key]
      }
      if (Object.keys(userUpdate).length === 0) {
        return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
      }
      const { error } = await adminClient
        .from('users')
        .update(userUpdate)
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Update Campaign
    if (resource === 'campaign') {
      const { error } = await adminClient
        .from('campaigns')
        .update(data)
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Update Dashboard Settings
    if (resource === 'dashboard_settings') {
      const { data: org } = await adminClient
        .from('orgs')
        .select('settings')
        .eq('id', profile.org_id)
        .single()

      const { error } = await adminClient
        .from('orgs')
        .update({
          settings: {
            ...org?.settings,
            dashboard: data.dashboard,
          }
        })
        .eq('id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Update Subcontractor
    if (resource === 'sub') {
      const { error } = await adminClient
        .from('subcontractors')
        .update(data)
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Update User Hierarchy (manager, region, team)
    if (resource === 'user_hierarchy') {
      const updateData: any = {}
      if ('manager_user_id' in data) updateData.manager_user_id = data.manager_user_id
      if ('region_id' in data) updateData.region_id = data.region_id
      if ('team_id' in data) updateData.team_id = data.team_id
      
      const { error } = await adminClient
        .from('users')
        .update(updateData)
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Update Proposal Template
    if (resource === 'proposal_template') {
      const { error } = await adminClient
        .from('proposal_templates')
        .update(data)
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid resource' }, { status: 400 })
  } catch (error) {
    console.error('Admin data API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to update' 
    }, { status: 500 })
  }
}

// DELETE - Delete admin data
export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request)
    if ('error' in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { searchParams } = new URL(request.url)
    const resource = searchParams.get('resource')
    const id = searchParams.get('id')
    const { profile, adminClient, isAdmin } = auth

    if (!isAdmin && !(['comp_plan', 'user_comp_plan'].includes(resource || '') && isPayrollAdminRole(profile.role))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    if (!id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 })
    }

    // Delete Region
    if (resource === 'region') {
      const { error } = await adminClient
        .from('regions')
        .delete()
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Delete Team
    if (resource === 'team') {
      const { error } = await adminClient
        .from('teams')
        .delete()
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Delete Comp Plan
    if (resource === 'comp_plan') {
      if (!isPayrollAdminRole(profile.role)) {
        return NextResponse.json({ error: 'Payroll administrator access required' }, { status: 403 })
      }
      const { error } = await adminClient
        .from('comp_plans')
        .update({ is_active: false, is_default: false })
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Delete User Comp Plan Assignment
    if (resource === 'user_comp_plan') {
      if (!isPayrollAdminRole(profile.role)) {
        return NextResponse.json({ error: 'Payroll administrator access required' }, { status: 403 })
      }
      const { data: assignment, error: readError } = await adminClient
        .from('user_comp_plans')
        .select('id, effective_from, effective_to')
        .eq('id', id)
        .eq('org_id', profile.org_id)
        .maybeSingle()

      if (readError || !assignment) {
        return NextResponse.json({ error: readError?.message || 'Assignment not found' }, { status: 404 })
      }

      const today = easternDateToday()
      if (assignment.effective_from > today) {
        const body = (await request.json().catch(() => ({}))) as { change_reason?: unknown }
        const reason = typeof body.change_reason === 'string' ? body.change_reason.trim() : ''
        if (!reason) {
          return NextResponse.json({ error: 'A cancellation reason is required' }, { status: 400 })
        }
        const { error } = await adminClient.rpc('cancel_scheduled_primary_comp_plan', {
          p_org_id: profile.org_id,
          p_assignment_id: id,
          p_created_by_user_id: auth.user.id,
          p_change_reason: reason,
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        return NextResponse.json({ success: true })
      }

      const effectiveTo =
        assignment.effective_to && assignment.effective_to < today
          ? assignment.effective_to
          : today
      const { error } = await adminClient
        .from('user_comp_plans')
        .update({ effective_to: effectiveTo })
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Delete Campaign
    if (resource === 'campaign') {
      const { error } = await adminClient
        .from('campaigns')
        .delete()
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Delete Subcontractor
    if (resource === 'sub') {
      const { error } = await adminClient
        .from('subcontractors')
        .delete()
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    // Delete Proposal Template
    if (resource === 'proposal_template') {
      const { error } = await adminClient
        .from('proposal_templates')
        .delete()
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid resource' }, { status: 400 })
  } catch (error) {
    console.error('Admin data API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to delete' 
    }, { status: 500 })
  }
}
