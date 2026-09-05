import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { canManageCanvassTerritories } from '@/lib/canvass-territory-manager-roles'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

export default async function AdminPage() {
  const supabase = createClient()
  
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    console.log('Admin page: No user or auth error', authError)
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  console.log('Admin page: User role check', { 
    userId: user.id, 
    profile, 
    profileError,
    role: profile?.role 
  })

  // Handle case where profile doesn't exist yet - create it
  if (!profile) {
    console.log('Admin page: No profile found, creating one')
    // Try to create a profile for this user
    const { data: org } = await supabase
      .from('orgs')
      .select('id')
      .limit(1)
      .single()
    
    if (org) {
      await supabase.from('users').insert({
        id: user.id,
        org_id: org.id,
        role: 'admin',
        email: user.email,
        full_name: user.email?.split('@')[0] || 'User',
      })
      // Reload the page to get the new profile
      redirect('/admin')
    } else {
      // No org exists, create one
      const { data: newOrg } = await supabase
        .from('orgs')
        .insert({ name: 'My Organization' })
        .select()
        .single()
      
      if (newOrg) {
        await supabase.from('users').insert({
          id: user.id,
          org_id: newOrg.id,
          role: 'admin',
          email: user.email,
          full_name: user.email?.split('@')[0] || 'User',
        })
        redirect('/admin')
      }
    }
    redirect('/dashboard')
  }

  // Admin home: leadership roles (aligns with canvass territory + user management APIs)
  const adminRoles = [
    'admin',
    'owner',
    'regional_manager',
    'regional_setter_manager',
    'sales_manager',
    'setter_manager',
    'manager',
    'operations',
  ]
  if (!adminRoles.includes(profile.role)) {
    console.log('Admin page: Access denied, role is:', profile.role)
    redirect('/dashboard')
  }

  // Check if user can access cost/pricing data (admin and operations only)
  const canAccessCostData = ['admin', 'operations'].includes(profile.role)
  const canAccessPayroll = ['admin', 'owner', 'operations'].includes(profile.role)
  const canAccessGoalsForecast = ['admin', 'owner'].includes(profile.role)
  // Work areas: reuse the shared helper so this stays in step with
  // /api/admin/canvass-territories instead of adding another role literal.
  const canManageWorkAreas = canManageCanvassTerritories(profile.role)

  const adminSections = [
    {
      title: 'Goals & Forecast',
      description: 'Monthly targets, scorecard, and revenue forecasting',
      href: '/admin/goals',
      requiresSuperuserAccess: true,
      accent: 'emerald',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
    {
      title: 'Settings',
      description: 'Workflows, fields, integrations, and system settings',
      href: '/admin/settings',
      accent: 'slate',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      title: 'Compensation Plans',
      description: 'Manage commission structures and user assignments',
      href: '/admin/comp-plans',
      accent: 'emerald',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      title: 'Sisu Incentive System',
      description: 'Heats, badges, setter ramp, and live field marketer accountability — all in one place',
      href: '/admin/sisu',
      sisuBranded: true,
    },
    {
      title: 'Campaigns & Lead Sources',
      description: 'Track marketing campaigns and configure inbound lead webhooks',
      href: '/admin/campaigns',
      accent: 'violet',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
        </svg>
      ),
    },
    {
      title: 'Roles & Permissions',
      description: 'Create custom roles and configure permissions',
      href: '/admin/roles',
      accent: 'slate',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
    },
    {
      title: 'Permission Presets',
      description: 'Create reusable permission templates for user setup',
      href: '/admin/presets',
      accent: 'slate',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
    },
    {
      title: 'Regions',
      description: 'Manage geographic regions for your organization',
      href: '/admin/regions',
      accent: 'cyan',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      title: 'Teams',
      description: 'Create and manage sales teams within regions',
      href: '/admin/teams',
      accent: 'sky',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
    },
    {
      title: 'Work areas',
      description: 'Draw canvass boundaries and assign reps or teams',
      href: '/admin/canvass-territories',
      requiresWorkAreaAccess: true,
      accent: 'cyan',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
      ),
    },
    {
      title: 'Users',
      description: 'Manage user accounts and role assignments',
      href: '/admin/users',
      accent: 'sky',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
    },
    {
      title: 'Scheduling',
      description: 'Configure round-robin and appointment settings',
      href: '/admin/scheduling',
      accent: 'cyan',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      title: 'Email Blasts',
      description: 'Choose which roles and people get sale and payment or funding-style emails',
      href: '/admin/email-blasts',
      accent: 'violet',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8m-16 9h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      title: 'Pricing & Costs',
      description: 'Set prices per square, PPW, dump costs, OPEX, and pricebook items',
      href: '/admin/pricing',
      requiresCostAccess: true, // Only admin and operations
      accent: 'emerald',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      title: 'Proposals & Adders',
      description: 'Manage add-ons (ventilation, gutters, skylights, etc.), pricing visibility, and PDF templates',
      href: '/admin/proposals',
      accent: 'violet',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      title: 'Financing programs',
      description: 'Lender names, APR, term length, and internal dealer fee for proposals',
      href: '/admin/financing-programs',
      requiresCostAccess: true,
      accent: 'emerald',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
      ),
    },
    {
      title: 'Payroll & commissions',
      description: 'Export, pay periods, hourly entry, consultant statements, and weekly eligibility',
      href: '/admin/payroll',
      requiresPayrollAccess: true,
      accent: 'emerald',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      title: 'Job Profit Tracker',
      description: 'Sheet-style accounting view of job contract, costs, profit, owner draw, and status',
      href: '/admin/job-profit-tracker',
      requiresPayrollAccess: true,
      accent: 'emerald',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 14h18M7 6h10M7 18h10M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" />
        </svg>
      ),
    },
    {
      title: 'Proposal Integrations',
      description: 'Connect EagleView, Roofr, Solo, Aurora, and more',
      href: '/admin/integrations',
      accent: 'cyan',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
        </svg>
      ),
    },
    {
      title: 'Roof Measure Tool',
      description: 'In-house satellite roof measurement tool',
      href: '/tools/roof-measure',
      accent: 'orange',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ),
    },
    {
      title: 'Print Kit',
      description: 'Door drop kit, appointment cards, and field marketing print tools',
      href: '/admin/print-kit',
      accent: 'orange',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 9h10M7 13h4" />
        </svg>
      ),
    },
    {
      title: 'Sub-Contractors',
      description: 'Manage sub-contractor network and portal access',
      href: '/admin/subs',
      accent: 'sky',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
    },
    {
      title: 'Crews',
      description: 'Manage in-house installation crews and teams',
      href: '/admin/crews',
      accent: 'sky',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
    },
    {
      title: 'Inspection Feedback',
      description: 'View pending feedback and resend reminders to closers',
      href: '/admin/inspection-feedback',
      accent: 'violet',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      ),
    },
  ]

  // Category-tinted tactile tile styles. All color classes are written as
  // complete literal strings so Tailwind JIT can detect them (no interpolation).
  const accentStyles: Record<
    string,
    { chip: string; icon: string; border: string; glow: string; line: string }
  > = {
    slate: {
      chip: 'bg-gradient-to-br from-slate-50 to-slate-100 ring-1 ring-slate-200 group-hover:from-slate-100 group-hover:to-slate-200',
      icon: 'text-slate-600 group-hover:text-slate-700',
      border: 'hover:border-slate-200',
      glow: 'bg-[radial-gradient(ellipse_at_70%_0%,rgba(100,116,139,0.10),transparent_60%)]',
      line: 'via-slate-300/60',
    },
    emerald: {
      chip: 'bg-gradient-to-br from-emerald-50 to-emerald-100 ring-1 ring-emerald-200 group-hover:from-emerald-100 group-hover:to-emerald-200',
      icon: 'text-emerald-600 group-hover:text-emerald-700',
      border: 'hover:border-emerald-200',
      glow: 'bg-[radial-gradient(ellipse_at_70%_0%,rgba(16,185,129,0.10),transparent_60%)]',
      line: 'via-emerald-300/60',
    },
    sky: {
      chip: 'bg-gradient-to-br from-sky-50 to-sky-100 ring-1 ring-sky-200 group-hover:from-sky-100 group-hover:to-sky-200',
      icon: 'text-sky-600 group-hover:text-sky-700',
      border: 'hover:border-sky-200',
      glow: 'bg-[radial-gradient(ellipse_at_70%_0%,rgba(14,165,233,0.10),transparent_60%)]',
      line: 'via-sky-300/60',
    },
    violet: {
      chip: 'bg-gradient-to-br from-violet-50 to-violet-100 ring-1 ring-violet-200 group-hover:from-violet-100 group-hover:to-violet-200',
      icon: 'text-violet-600 group-hover:text-violet-700',
      border: 'hover:border-violet-200',
      glow: 'bg-[radial-gradient(ellipse_at_70%_0%,rgba(139,92,246,0.10),transparent_60%)]',
      line: 'via-violet-300/60',
    },
    orange: {
      chip: 'bg-gradient-to-br from-orange-50 to-orange-100 ring-1 ring-orange-200 group-hover:from-orange-100 group-hover:to-orange-200',
      icon: 'text-orange-600 group-hover:text-orange-700',
      border: 'hover:border-orange-200',
      glow: 'bg-[radial-gradient(ellipse_at_70%_0%,rgba(249,115,22,0.10),transparent_60%)]',
      line: 'via-orange-300/60',
    },
    cyan: {
      chip: 'bg-gradient-to-br from-cyan-50 to-cyan-100 ring-1 ring-cyan-200 group-hover:from-cyan-100 group-hover:to-cyan-200',
      icon: 'text-cyan-600 group-hover:text-cyan-700',
      border: 'hover:border-cyan-200',
      glow: 'bg-[radial-gradient(ellipse_at_70%_0%,rgba(6,182,212,0.10),transparent_60%)]',
      line: 'via-cyan-300/60',
    },
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Admin</h1>
          <p className="mt-2 text-gray-600">Manage your organization settings</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {adminSections
            .filter((section) => {
              if ((section as { requiresSuperuserAccess?: boolean }).requiresSuperuserAccess && !canAccessGoalsForecast) {
                return false
              }
              if (section.requiresCostAccess && !canAccessCostData) {
                return false
              }
              if ((section as { requiresPayrollAccess?: boolean }).requiresPayrollAccess && !canAccessPayroll) {
                return false
              }
              if ((section as { requiresWorkAreaAccess?: boolean }).requiresWorkAreaAccess && !canManageWorkAreas) {
                return false
              }
              return true
            })
            .map((section) => {
            const isSisu = 'sisuBranded' in section && section.sisuBranded
            const accent =
              accentStyles[
                ('accent' in section && section.accent) || 'slate'
              ] ?? accentStyles.slate
            return (
            <Link
              key={section.href}
              href={section.href}
              className={`relative overflow-hidden rounded-xl p-6 transition-all group ${
                isSisu
                  ? 'border-2 border-amber-500/45 bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 shadow-lg shadow-black/30 ring-1 ring-amber-600/20 hover:border-amber-400/65 hover:shadow-xl hover:shadow-amber-950/25'
                  : `border border-gray-200 bg-white shadow-sm hover:shadow-md ${accent.border}`
              }`}
            >
              {isSisu ? (
                <>
                  <div
                    className="pointer-events-none absolute inset-0 rounded-xl bg-[radial-gradient(ellipse_at_30%_0%,rgba(251,191,36,0.12),transparent_55%),radial-gradient(ellipse_at_80%_100%,rgba(99,102,241,0.08),transparent_50%)]"
                    aria-hidden="true"
                  />
                  <div
                    className="pointer-events-none absolute inset-[5px] rounded-[10px] border border-white/[0.07]"
                    aria-hidden="true"
                  />
                  <div
                    className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/50 to-transparent"
                    aria-hidden="true"
                  />
                  <div className="relative mb-4 h-8">
                    <div className="inline-flex h-8 items-center rounded-md border border-amber-500/35 bg-gradient-to-b from-slate-800/90 to-gray-950 px-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_2px_8px_rgba(0,0,0,0.45)]">
                      <img
                        src="/brand/sisu-logo.svg"
                        alt=""
                        width={116}
                        height={60}
                        className="h-[18px] w-auto shrink-0"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div
                    className={`pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity group-hover:opacity-100 ${accent.glow}`}
                    aria-hidden="true"
                  />
                  <div
                    className={`pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent to-transparent ${accent.line}`}
                    aria-hidden="true"
                  />
                  <div
                    className={`relative mb-4 flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${accent.chip}`}
                  >
                    <div
                      className={`flex h-6 w-6 items-center justify-center transition-colors [&>svg]:h-6 [&>svg]:w-6 ${accent.icon}`}
                    >
                      {'icon' in section ? section.icon : null}
                    </div>
                  </div>
                </>
              )}
              <h2
                className={`relative mb-1 text-lg font-semibold ${
                  isSisu ? 'text-white' : 'text-gray-900'
                }`}
              >
                {section.title}
              </h2>
              <p
                className={`relative text-sm ${
                  isSisu ? 'text-slate-400' : 'text-gray-500'
                }`}
              >
                {section.description}
              </p>
              {isSisu ? (
                <p className="relative mt-2.5 text-[9px] font-bold uppercase tracking-[0.28em] text-amber-400/75">
                  GRIT PAYS
                </p>
              ) : null}
            </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
