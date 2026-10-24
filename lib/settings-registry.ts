/**
 * The one list of everything an admin can configure, grouped, for the Settings page (app/admin/page.tsx).
 * Access mirrors what each card's own gate has always been (the hub only hides what the page itself would refuse).
 */
export type SettingsAccess = 'leadership' | 'cost' | 'payroll' | 'superuser' | 'workAreas' | 'owner'

export type SettingsItem = { title: string; description: string; href: string; access: SettingsAccess; keywords?: string }
export type SettingsGroup = { id: string; title: string; items: SettingsItem[] }

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: 'people',
    title: 'People & access',
    items: [
      { title: 'Users', description: 'Accounts, roles and who reports to whom', href: '/admin/users', access: 'leadership' },
      { title: 'Roles & permissions', description: 'Create roles and choose what each can do', href: '/admin/roles', access: 'leadership' },
      { title: 'Money access', description: 'Who can see company financials and who can record job money (owners only)', href: '/admin/money-access', access: 'owner', keywords: 'financials permission payments profit' },
      { title: 'Presets', description: 'Reusable permission sets for setting up a new user', href: '/admin/presets', access: 'leadership', keywords: 'templates' },
      { title: 'Teams', description: 'Sales teams within regions', href: '/admin/teams', access: 'leadership' },
      { title: 'Regions', description: 'Geographic regions for the company', href: '/admin/regions', access: 'leadership' },
    ],
  },
  {
    id: 'sales',
    title: 'Sales setup',
    items: [
      { title: 'Pricing & costs', description: 'Price per square, dump costs, overhead and pricebook items', href: '/admin/pricing', access: 'cost' },
      { title: 'Proposals & add-ons', description: 'Ventilation, gutters, skylights, price visibility, PDF templates', href: '/admin/proposals', access: 'leadership', keywords: 'adders' },
      { title: 'Financing programs', description: 'Lenders, APR, term and the dealer fee', href: '/admin/financing-programs', access: 'leadership' },
      { title: 'Appointment scheduling', description: 'Round-robin and appointment settings', href: '/admin/scheduling', access: 'leadership', keywords: 'calendar google' },
      { title: 'Campaigns & lead sources', description: 'Marketing campaigns and inbound lead webhooks', href: '/admin/campaigns', access: 'leadership' },
      { title: 'Work areas', description: 'Draw canvass areas and assign reps or teams', href: '/canvass?areas=1', access: 'workAreas', keywords: 'territories' },
      { title: 'Print Kit', description: 'Door-drop kit, appointment cards and print tools', href: '/admin/print-kit', access: 'leadership' },
      { title: 'Door drops', description: 'Door-drop campaigns', href: '/admin/door-drop', access: 'leadership' },
      { title: 'Inspection feedback', description: 'Pending feedback and reminders to closers', href: '/admin/inspection-feedback', access: 'leadership' },
      { title: 'Roof measure tool', description: 'In-house satellite roof measurement', href: '/tools/roof-measure', access: 'leadership' },
      { title: 'Email blasts', description: 'Who gets sale, payment and funding emails', href: '/admin/email-blasts', access: 'leadership' },
    ],
  },
  {
    id: 'money',
    title: 'Money',
    items: [
      { title: 'Compensation plans', description: 'Commission structures and who is on which plan', href: '/admin/comp-plans', access: 'leadership', keywords: 'commission pay plan default' },
      { title: 'Payroll & commissions', description: 'Pay periods, hourly entry, statements and exports', href: '/admin/payroll', access: 'payroll' },
      { title: 'Job profit tracker', description: 'Contract, costs, profit and owner draw by job', href: '/admin/job-profit-tracker', access: 'payroll' },
      { title: 'Goals & forecast', description: 'Monthly targets, scorecard and revenue forecast', href: '/admin/goals', access: 'superuser' },
    ],
  },
  {
    id: 'incentives',
    title: 'Incentives',
    items: [
      { title: 'Incentives', description: 'Heats, badges, setter ramp, bonus approval and accountability', href: '/admin/sisu/incentives', access: 'leadership', keywords: 'sisu bonus ramp heats badges' },
    ],
  },
  {
    id: 'operations',
    title: 'Operations',
    items: [
      { title: 'Subcontractors', description: 'Sub network, contacts and calendar sharing', href: '/admin/subs', access: 'leadership', keywords: 'subs crews installers' },
      { title: 'Crews', description: 'In-house installation crews', href: '/admin/crews', access: 'leadership' },
      { title: 'Suppliers', description: 'Supplier accounts and ordering', href: '/admin/suppliers', access: 'leadership', keywords: 'abc materials' },
    ],
  },
  {
    id: 'system',
    title: 'System',
    items: [
      { title: 'Company settings', description: 'Workflows, fields, dispositions and system options', href: '/admin/settings', access: 'leadership' },
      { title: 'Integrations', description: 'EagleView, Roofr, Solo, Aurora and more', href: '/admin/integrations', access: 'leadership' },
      { title: 'Dashboard settings', description: 'What shows on each dashboard', href: '/admin/dashboard-settings', access: 'leadership' },
      { title: 'Announcements', description: "What's-new banners shown to the team", href: '/admin/announcements', access: 'leadership' },
      { title: 'My settings', description: 'Your profile, notifications and Google Calendar', href: '/settings', access: 'leadership' },
    ],
  },
]

export type SettingsViewer = { role: string }

const LEADERSHIP = ['admin', 'owner', 'regional_manager', 'regional_setter_manager', 'sales_manager', 'setter_manager', 'manager', 'operations']

export function canOpenSettingsHub(role: string): boolean {
  return LEADERSHIP.includes(role)
}

export function visibleSettingsGroups(flags: { canCost: boolean; canPayroll: boolean; canSuperuser: boolean; canWorkAreas: boolean; canOwner?: boolean }): SettingsGroup[] {
  const ok = (a: SettingsAccess) =>
    a === 'leadership' || (a === 'cost' && flags.canCost) || (a === 'payroll' && flags.canPayroll) || (a === 'superuser' && flags.canSuperuser) || (a === 'workAreas' && flags.canWorkAreas) || (a === 'owner' && !!flags.canOwner)
  return SETTINGS_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => ok(i.access)) })).filter((g) => g.items.length > 0)
}

/** Case-insensitive match on title, description and keywords; every word must match somewhere. */
export function filterSettingsGroups(groups: SettingsGroup[], query: string): SettingsGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return groups
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => {
        const hay = `${i.title} ${i.description} ${i.keywords ?? ''} ${g.title}`.toLowerCase()
        return words.every((w) => hay.includes(w))
      }),
    }))
    .filter((g) => g.items.length > 0)
}
