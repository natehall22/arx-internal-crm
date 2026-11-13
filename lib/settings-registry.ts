/**
 * The one list of everything an admin can configure, grouped, for the Settings page (app/admin/page.tsx).
 * Access mirrors what each card's own gate has always been (the hub only hides what the page itself would refuse).
 */
import type { OrgFeature, OrgFeatures } from '@/lib/org-features'
import type { Terms } from '@/lib/industry-profiles'

/** `superAdmin` = `isSuperAdmin` (users.is_super_admin) — stricter than `owner`, which also lets the owner role in. */
export type SettingsAccess = 'leadership' | 'cost' | 'payroll' | 'superuser' | 'workAreas' | 'owner' | 'superAdmin'

/** `feature` = hidden when the company has that feature switched off (lib/org-features.ts). */
export type SettingsItem = { title: string; description: string; href: string; access: SettingsAccess; keywords?: string; feature?: OrgFeature }
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
      { title: 'Lead routing', description: 'Who gets new website leads (one person, take turns, or by service) and reminders for leads nobody has contacted', href: '/admin/lead-routing', access: 'superuser', keywords: 'assign round robin turns website form inquiry owner overdue follow up untouched' },
      { title: 'Work areas', description: 'Draw canvass areas and assign reps or teams', href: '/canvass?areas=1', access: 'workAreas', keywords: 'territories', feature: 'canvassing' },
      { title: 'Print Kit', description: 'Door-drop kit, appointment cards and print tools', href: '/admin/print-kit', access: 'leadership' },
      { title: 'Door drops', description: 'Door-drop campaigns', href: '/admin/door-drop', access: 'leadership' },
      { title: 'Inspection feedback', description: 'Pending feedback and reminders to closers', href: '/admin/inspection-feedback', access: 'leadership' },
      { title: 'Roof measure tool', description: 'In-house satellite roof measurement', href: '/tools/roof-measure', access: 'leadership', feature: 'roofMeasure' },
      { title: 'Email blasts', description: 'Who gets sale, payment and funding emails', href: '/admin/email-blasts', access: 'leadership' },
      { title: 'Customer portal', description: 'Who can sign in to their account and how install dates read (owners only)', href: '/admin/customer-portal', access: 'superAdmin', feature: 'customerPortal', keywords: 'portal customer account invite sign in install date week photos' },
      { title: 'Customer messages', description: 'Visit reminders, “on the way” and “done” emails, quote follow-ups and invoice reminders (owners only)', href: '/admin/customer-messages', access: 'superAdmin', feature: 'customerMessages', keywords: 'reminder email notify customer automatic follow up unsubscribe quiet hours overdue on the way' },
      { title: 'Texting', description: 'Your company’s texting number and its status, the details carriers ask for, usage and texts nobody could be matched to (owners only)', href: '/admin/texting', access: 'superAdmin', feature: 'texting', keywords: 'sms text message number 10dlc stop opt out consent reminders' },
    ],
  },
  {
    id: 'money',
    title: 'Money',
    items: [
      { title: 'Compensation plans', description: 'Commission structures and who is on which plan', href: '/admin/comp-plans', access: 'leadership', keywords: 'commission pay plan default' },
      { title: 'Payroll & commissions', description: 'Pay periods, hourly entry, statements and exports', href: '/admin/payroll', access: 'payroll' },
      { title: 'Job profit tracker', description: 'Contract, costs, profit and owner draw by job', href: '/admin/job-profit-tracker', access: 'payroll' },
      { title: 'Online payments', description: 'Connect your Stripe account, pay links, bank payments and automatic payments (owners only)', href: '/admin#online-payments', access: 'superAdmin', feature: 'onlinePayments', keywords: 'stripe card credit ach bank autopay pay link deposit' },
      { title: 'QuickBooks', description: 'Connect your QuickBooks Online company (owners only)', href: '/admin#quickbooks', access: 'superAdmin', feature: 'quickbooks', keywords: 'quickbooks accounting bookkeeper books intuit qbo' },
      { title: 'Sales tax', description: 'Tax rates on quotes and invoices, the default, or no tax at all (owners only)', href: '/admin#sales-tax', access: 'superAdmin', keywords: 'tax rate state county exempt taxable vat' },
      { title: 'Quotes', description: 'Default deposit, how long quote links work, and the terms customers approve (owners only)', href: '/admin#quotes', access: 'superAdmin', feature: 'quoteApproval', keywords: 'quote proposal approval deposit terms online' },
      { title: 'Hourly billing', description: 'Rounding, minimum hours per visit, drive time and crew-hours for work billed by the hour (owners only)', href: '/admin#hourly-billing', access: 'superAdmin', keywords: 'time materials t&m hourly rounding minimum trip charge tractor equipment', feature: 'hourlyBilling' },
      { title: 'Goals & forecast', description: 'Monthly targets, scorecard and revenue forecast', href: '/admin/goals', access: 'superuser' },
    ],
  },
  {
    id: 'incentives',
    title: 'Sisu program',
    items: [
      { title: 'Sisu program', description: 'Heats, badges, setter ramp and accountability', href: '/admin/sisu/incentives', access: 'leadership', keywords: 'sisu bonus ramp heats badges' },
    ],
  },
  {
    id: 'operations',
    title: 'Operations',
    items: [
      { title: 'Job setup', description: 'Your trades list (owners only)', href: '/admin/job-setup', access: 'superAdmin', keywords: 'trades crews gutters siding windows' },
      { title: 'Subcontractors', description: 'Sub network, contacts and calendar sharing', href: '/admin/subs', access: 'leadership', keywords: 'subs crews installers' },
      { title: 'Crews', description: 'In-house installation crews', href: '/admin/crews', access: 'leadership' },
      { title: 'Time clock', description: 'Crew time for the pay week; who clocks in is set on each crew under Subcontractors', href: '/admin/time', access: 'payroll', keywords: 'hours clock in out timesheet lunch overtime', feature: 'timeTracking' },
      { title: 'Suppliers', description: 'Supplier accounts and ordering', href: '/admin/suppliers', access: 'leadership', keywords: 'abc materials' },
      { title: 'Job catch-up', description: 'One line per job: who has it, what’s next, what’s stuck', href: '/admin#job-catch-up', access: 'leadership', keywords: 'asana stuck board status where this stands owner working days' },
      { title: 'Customer checkups', description: 'Inspections and check-in calls after every install', href: '/admin#checkups', access: 'leadership', keywords: 'maintenance mid year annual inspection follow up past customers' },
    ],
  },
  {
    id: 'system',
    title: 'System',
    items: [
      { title: 'Company settings', description: 'Workflows, dispositions and system options', href: '/admin/settings', access: 'leadership' },
      { title: 'Industry profile', description: 'Your type of business: sets the starting features, trades, words and menu (owners only)', href: '/admin#industry-profile', access: 'superAdmin', keywords: 'roofing lawn landscape cleaning builder template industry terminology' },
      { title: 'Move from Jobber', description: 'Bring customers, properties, plans, invoices and your price book over from Jobber (owners only)', href: '/admin/import/jobber', access: 'superAdmin', keywords: 'import migrate csv export switch move jobber clients data' },
      { title: 'Move signed documents', description: 'Bring contracts already signed in DocuSign, Dropbox Sign or PandaDoc into customer documents (owners only)', href: '/admin/import/signed-documents', access: 'superAdmin', keywords: 'import docusign dropbox sign pandadoc signed contracts envelopes zip pdf move' },
      { title: 'Custom fields', description: 'Your own fields on customers, properties and jobs (owners only)', href: '/admin/custom-fields', access: 'superAdmin', keywords: 'contact fields project fields work order fields extra gate code dropdown required' },
      { title: 'AI connector', description: 'Let people use Claude or ChatGPT to look things up as themselves: who is connected, activity (owners only)', href: '/admin/ai-connector', access: 'superAdmin', keywords: 'ai claude chatgpt mcp assistant connector openai' },
      { title: 'Features', description: 'Turn whole parts of the app on or off for your company (owners only)', href: '/admin#features', access: 'superAdmin', keywords: 'canvass insurance roof measure sisu incentives squares switch hide' },
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

export function visibleSettingsGroups(flags: { canCost: boolean; canPayroll: boolean; canSuperuser: boolean; canWorkAreas: boolean; canOwner?: boolean; canSuperAdmin?: boolean; features?: Partial<OrgFeatures>; terms?: Pick<Terms, 'subs'> }): SettingsGroup[] {
  const featureOn = (i: SettingsItem) => !i.feature || flags.features?.[i.feature] !== false
  const ok = (a: SettingsAccess) =>
    a === 'leadership' || (a === 'cost' && flags.canCost) || (a === 'payroll' && flags.canPayroll) || (a === 'superuser' && flags.canSuperuser) || (a === 'workAreas' && flags.canWorkAreas) || (a === 'owner' && !!flags.canOwner) || (a === 'superAdmin' && !!flags.canSuperAdmin)
  // The company's word for subcontractors (industry profile; roofing = "Subcontractors", unchanged).
  const word = (i: SettingsItem): SettingsItem => (i.href === '/admin/subs' && flags.terms ? { ...i, title: flags.terms.subs } : i)
  return SETTINGS_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => ok(i.access) && featureOn(i)).map(word) })).filter((g) => g.items.length > 0)
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
