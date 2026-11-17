/**
 * The one list of everything an admin can configure, grouped, for the Settings page (app/admin/page.tsx). Cards with no page of their own live at /admin/s/<slug> (app/admin/s/[section]/page.tsx), gated by this same list.
 * Access mirrors what each card's own gate has always been (the hub only hides what the page itself would refuse).
 */
import type { OrgFeature, OrgFeatures } from '@/lib/org-features'
import type { IndustryProfileId, Terms } from '@/lib/industry-profiles'

/** `superAdmin` = `isSuperAdmin` (users.is_super_admin) — stricter than `owner`, which also lets the owner role in. */
export type SettingsAccess = 'leadership' | 'cost' | 'payroll' | 'superuser' | 'workAreas' | 'owner' | 'superAdmin'

/** `cards` = a topic page (/admin/s/<page>): the hub shows the page, not each card; it is shown when at least one of its SETTINGS_CARDS is, and its text and search words come from the cards this viewer can see.
 * `feature` = hidden when the company has that feature switched off (lib/org-features.ts). */
export type SettingsItem = { title: string; description: string; href: string; access: SettingsAccess; keywords?: string; feature?: OrgFeature; profile?: IndustryProfileId; cards?: string[]; cardLinks?: SettingsCardLink[] }
/** A viewer-visible card on a topic page, for search deep links. */
export type SettingsCardLink = { title: string; href: string; hay: string }
export type SettingsGroup = { id: string; title: string; items: SettingsItem[] }

/** Settings that are cards open on a topic page: /admin/s/<page>#<card>. */
export const SETTINGS_SECTION_PREFIX = '/admin/s/'

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
      { title: 'Quotes & signing', description: 'Proposal wording, quote links and deposits, and the e-sign notice and reminders (owners only)', href: '/admin/s/quotes', access: 'superAdmin', cards: ['/admin/s/quotes#proposal-content', '/admin/s/quotes#quotes', '/admin/s/quotes#signing'], keywords: 'proposal quote deposit esign signature' },
      { title: 'Pricing & costs', description: 'Price per square, dump costs, overhead and pricebook items', href: '/admin/pricing', access: 'cost' },
      { title: 'Proposals & add-ons', description: 'Ventilation, gutters, skylights, price visibility, PDF templates', href: '/admin/proposals', access: 'leadership', keywords: 'adders' },
      { title: 'Financing programs', description: 'Lenders, APR, term and the dealer fee', href: '/admin/financing-programs', access: 'leadership' },
      { title: 'Appointment scheduling', description: 'Round-robin and appointment settings', href: '/admin/scheduling', access: 'leadership', keywords: 'calendar google' },
      { title: 'Contracts & templates', description: 'Your agreements and other documents to sign: upload once, place the fields, reuse.', href: '/signing#templates', access: 'leadership', keywords: 'signature sign esign agreement document template contract' },
      { title: 'Campaigns & lead sources', description: 'Marketing campaigns and inbound lead webhooks', href: '/admin/campaigns', access: 'leadership' },
      { title: 'Lead routing', description: 'Who gets new website leads (one person, take turns, or by service) and reminders for leads nobody has contacted', href: '/admin/lead-routing', access: 'superuser', keywords: 'assign round robin turns website form inquiry owner overdue follow up untouched' },
      { title: 'Work areas', description: 'Draw canvass areas and assign reps or teams', href: '/canvass?areas=1', access: 'workAreas', keywords: 'territories', feature: 'canvassing' },
      { title: 'Print Kit', description: 'Door-drop kit, appointment cards and print tools', href: '/admin/print-kit', access: 'leadership' },
      { title: 'Door drops', description: 'Door-drop campaigns', href: '/admin/door-drop', access: 'leadership', profile: 'roofing' },
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
      { title: 'Payments & tax', description: 'Sales tax, online payments, QuickBooks and hourly billing (owners only)', href: '/admin/s/payments', access: 'superAdmin', cards: ['/admin/s/payments#sales-tax', '/admin/s/payments#online-payments', '/admin/s/payments#quickbooks', '/admin/s/payments#hourly-billing'], keywords: 'stripe tax accounting' },
      { title: 'Compensation plans', description: 'Commission structures and who is on which plan', href: '/admin/comp-plans', access: 'leadership', keywords: 'commission pay plan default' },
      { title: 'Payroll & commissions', description: 'Pay periods, hourly entry, statements and exports', href: '/admin/payroll', access: 'payroll' },
      { title: 'Job profit tracker', description: 'Contract, costs, profit and owner draw by job', href: '/admin/job-profit-tracker', access: 'payroll' },
      { title: 'Goals & forecast', description: 'Monthly targets, scorecard and revenue forecast', href: '/admin/goals', access: 'superuser' },
    ],
  },
  {
    id: 'incentives',
    title: 'Sisu program',
    items: [
      { title: 'Sisu program', description: 'Heats, badges, setter ramp and accountability', href: '/admin/sisu/incentives', access: 'leadership', keywords: 'sisu incentives ramp heats badges' },
    ],
  },
  {
    id: 'operations',
    title: 'Operations',
    items: [
      { title: 'Jobs & plans', description: 'Service plans, job catch-up, customer checkups and crew incentives', href: '/admin/s/jobs', access: 'leadership', cards: ['/admin/s/jobs#plan-templates', '/admin/s/jobs#job-catch-up', '/admin/s/jobs#checkups', '/admin/s/jobs#crew-incentives'], keywords: 'recurring stuck bonus' },
      { title: 'Job setup', description: 'Your trades list and work categories: Residential, Commercial, New build and your own (owners only)', href: '/admin/job-setup', access: 'superAdmin', keywords: 'trades crews gutters siding windows categories category residential commercial new build' },
      { title: 'Subcontractors', description: 'Sub network, contacts and calendar sharing', href: '/admin/subs', access: 'leadership', keywords: 'subs crews installers' },
      { title: 'Crews', description: 'In-house installation crews', href: '/admin/crews', access: 'leadership' },
      { title: 'Time clock', description: 'Crew time for the pay week; who clocks in is set on each crew under Subcontractors', href: '/admin/time', access: 'payroll', keywords: 'hours clock in out timesheet lunch overtime', feature: 'timeTracking' },
      { title: 'Suppliers', description: 'Supplier accounts and ordering', href: '/admin/suppliers', access: 'leadership', keywords: 'abc materials' },
    ],
  },
  {
    id: 'system',
    title: 'System',
    items: [
      { title: 'Company & features', description: 'Your type of business, and which parts of the app are on (owners only)', href: '/admin/s/company', access: 'superAdmin', cards: ['/admin/s/company#industry-profile', '/admin/s/company#features'], keywords: 'industry profile switch' },
      { title: 'Company settings', description: 'Workflows, dispositions and system options', href: '/admin/settings', access: 'leadership' },
      { title: 'Move from Jobber', description: 'Bring customers, properties, plans, invoices and your price book over from Jobber (owners only)', href: '/admin/import/jobber', access: 'superAdmin', keywords: 'import migrate csv export switch move jobber clients data' },
      { title: 'Move signed documents', description: 'Bring contracts already signed in DocuSign, Dropbox Sign or PandaDoc into customer documents (owners only)', href: '/admin/import/signed-documents', access: 'superAdmin', keywords: 'import docusign dropbox sign pandadoc signed contracts envelopes zip pdf move' },
      { title: 'Custom fields', description: 'Your own fields on customers, properties and jobs (owners only)', href: '/admin/custom-fields', access: 'superAdmin', keywords: 'contact fields project fields work order fields extra gate code dropdown required' },
      { title: 'AI connector', description: 'Let people use Claude or ChatGPT to look things up as themselves: who is connected, activity (owners only)', href: '/admin/ai-connector', access: 'superAdmin', keywords: 'ai claude chatgpt mcp assistant connector openai' },
      { title: 'Dashboard settings', description: 'What shows on each dashboard', href: '/admin/dashboard-settings', access: 'leadership' },
      { title: 'Announcements', description: "What's-new banners shown to the team", href: '/admin/announcements', access: 'leadership' },
      { title: 'My settings', description: 'Your profile, notifications and Google Calendar', href: '/settings', access: 'leadership' },
    ],
  },
]

/** Old `/admin#<card>` anchors -> the card's new place (`/admin/s/<page>#<card>`), for bookmarks and emails sent before the split. */

/**
 * Settings that are cards on a topic page (/admin/s/<page>#<card>). Not menu entries of their own: each belongs to exactly one page
 * entry's `cards`. Their access/feature/profile is the gate for the card AND for whether the page lists it.
 */
export const SETTINGS_CARDS: SettingsItem[] = [
      { title: 'Service plans', description: 'Recurring services like weekly or bi-weekly mowing: seasons, prices, what’s included', href: '/admin/s/jobs#plan-templates', access: 'superAdmin', feature: 'servicePlans', keywords: 'mowing recurring plan template weekly biweekly season' },
      { title: 'E-sign settings', description: 'The e-sign notice, decline, filing, reminders and signed-copy emails (owners only)', href: '/admin/s/quotes#signing', access: 'superAdmin', keywords: 'signature signing esign reminder decline signed copy notice' },
      { title: 'Online payments', description: 'Connect your Stripe account, pay links, bank payments and automatic payments (owners only)', href: '/admin/s/payments#online-payments', access: 'superAdmin', feature: 'onlinePayments', keywords: 'stripe card credit ach bank autopay pay link deposit' },
      { title: 'QuickBooks', description: 'Connect your QuickBooks Online company (owners only)', href: '/admin/s/payments#quickbooks', access: 'superAdmin', feature: 'quickbooks', keywords: 'quickbooks accounting bookkeeper books intuit qbo' },
      { title: 'Sales tax', description: 'Tax rates on quotes and invoices, the default, or no tax at all (owners only)', href: '/admin/s/payments#sales-tax', access: 'superAdmin', keywords: 'tax rate state county exempt taxable vat' },
      { title: 'Proposal content', description: 'The cover subtitle, process steps and why-choose-us text on the proposal PDF (owners only)', href: '/admin/s/quotes#proposal-content', access: 'superAdmin', keywords: 'proposal quote pdf cover process why choose us wording text' },
      { title: 'Quotes', description: 'Default deposit, how long quote links work, and the terms customers approve (owners only)', href: '/admin/s/quotes#quotes', access: 'superAdmin', feature: 'quoteApproval', keywords: 'quote proposal approval deposit terms online' },
      { title: 'Crew incentives', description: 'Automatic crew bonuses for visits done right, beating the time, reviews and weekly targets; each one still needs an owner’s approval (owners only)', href: '/admin/s/jobs#crew-incentives', access: 'superAdmin', profile: 'lawn_landscape', keywords: 'bonus crew incentive callback review target split photos' },
      { title: 'Hourly billing', description: 'Rounding, minimum hours per visit, drive time and crew-hours for work billed by the hour (owners only)', href: '/admin/s/payments#hourly-billing', access: 'superAdmin', keywords: 'time materials t&m hourly rounding minimum trip charge tractor equipment', feature: 'hourlyBilling' },
      { title: 'Job catch-up', description: 'One line per job: who has it, what’s next, what’s stuck', href: '/admin/s/jobs#job-catch-up', access: 'leadership', keywords: 'asana stuck board status where this stands owner working days' },
      { title: 'Customer checkups', description: 'Inspections and check-in calls after every install', href: '/admin/s/jobs#checkups', access: 'leadership', keywords: 'maintenance mid year annual inspection follow up past customers' },
      { title: 'Industry profile', description: 'Your type of business: sets the starting features, trades, words and menu (owners only)', href: '/admin/s/company#industry-profile', access: 'superAdmin', keywords: 'roofing lawn landscape cleaning builder template industry terminology' },
      { title: 'Features', description: 'Turn whole parts of the app on or off for your company (owners only)', href: '/admin/s/company#features', access: 'superAdmin', keywords: 'canvass insurance roof measure sisu incentives squares switch hide' },
]

/** Old `/admin#<card>` anchors -> the card's new place (`/admin/s/<page>#<card>`), for bookmarks and emails sent before the split. */
export const LEGACY_ANCHOR_HREFS: Record<string, string> = Object.fromEntries(SETTINGS_CARDS.map((c) => [c.href.split('#')[1], c.href]))

export type SettingsViewer = { role: string }

const LEADERSHIP = ['admin', 'owner', 'regional_manager', 'regional_setter_manager', 'sales_manager', 'setter_manager', 'manager', 'operations']

export function canOpenSettingsHub(role: string): boolean {
  return LEADERSHIP.includes(role)
}

export type SettingsFlags = { canCost: boolean; canPayroll: boolean; canSuperuser: boolean; canWorkAreas: boolean; canOwner?: boolean; canSuperAdmin?: boolean; features?: Partial<OrgFeatures>; terms?: Pick<Terms, 'subs'>; profileId?: IndustryProfileId; hiddenHrefs?: readonly string[]; text?: Readonly<Record<string, string>> }

const findItem = (href: string) => [...SETTINGS_GROUPS.flatMap((g) => g.items), ...SETTINGS_CARDS].find((i) => i.href === href)

/** The ONE gate for a hub entry, a card and the page behind them: access role + company feature + industry profile + profile-hidden list. */
export function isSettingsItemVisible(i: SettingsItem, flags: SettingsFlags): boolean {
  if (flags.hiddenHrefs?.includes(i.href)) return false
  // A topic page is shown when at least one of its cards is.
  if (i.cards) return i.cards.some((h) => { const c = findItem(h); return !!c && isSettingsItemVisible(c, flags) })
  const ok = (a: SettingsAccess) =>
    a === 'leadership' || (a === 'cost' && flags.canCost) || (a === 'payroll' && flags.canPayroll) || (a === 'superuser' && flags.canSuperuser) || (a === 'workAreas' && flags.canWorkAreas) || (a === 'owner' && !!flags.canOwner) || (a === 'superAdmin' && !!flags.canSuperAdmin)
  return ok(i.access) && (!i.feature || flags.features?.[i.feature] !== false) && (!i.profile || flags.profileId === i.profile)
}

/** The company's word for subcontractors and its own descriptions (industry profile; roofing = "Subcontractors", unchanged). */
function wordSettingsItem(i: SettingsItem, flags: SettingsFlags): SettingsItem {
  const own = flags.text?.[i.href]
  const named = i.href === '/admin/subs' && flags.terms ? { ...i, title: flags.terms.subs } : i
  const worded = own ? { ...named, description: own } : named
  if (!i.cards) return worded
  // A topic page lists only the cards THIS viewer can open, and is found by any of their words.
  const seen = i.cards.map(findItem).filter((c): c is SettingsItem => !!c && isSettingsItemVisible(c, flags)).map((c) => wordSettingsItem(c, flags))
  const hay = (c: SettingsItem) => `${c.title} ${c.description} ${c.keywords ?? ''}`
  return {
    ...worded,
    description: own ?? seen.map((c) => c.title).join(', '),
    keywords: [i.keywords, ...seen.map(hay)].filter(Boolean).join(' '),
    cardLinks: seen.map((c) => ({ title: c.title, href: c.href, hay: hay(c).toLowerCase() })),
  }
}

/** One hub entry or card, wording applied, or null when this viewer may not open it (used by the /admin/s/<page> pages). */
export function visibleSettingsItem(href: string, flags: SettingsFlags): SettingsItem | null {
  const item = findItem(href)
  return item && isSettingsItemVisible(item, flags) ? wordSettingsItem(item, flags) : null
}

export function visibleSettingsGroups(flags: SettingsFlags): SettingsGroup[] {
  return SETTINGS_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => isSettingsItemVisible(i, flags)).map((i) => wordSettingsItem(i, flags)) })).filter((g) => g.items.length > 0)
}

/** Every entry a viewer can reach from the menu: the entries themselves plus the cards inside their pages. */
export const reachableSettingsHrefs = (groups: SettingsGroup[]): string[] => groups.flatMap((g) => g.items.flatMap((i) => [i.href, ...(i.cardLinks ?? []).map((c) => c.href)]))

/**
 * Case-insensitive match on title, description and keywords; every word must match somewhere.
 * A topic page found only through one card's words opens that card (`page#card`); found by its own title it opens the page.
 */
export function filterSettingsGroups(groups: SettingsGroup[], query: string): SettingsGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return groups
  return groups
    .map((g) => ({
      ...g,
      items: g.items
        .filter((i) => words.every((w) => `${i.title} ${i.description} ${i.keywords ?? ''} ${g.title}`.toLowerCase().includes(w)))
        .map((i) => {
          const own = `${i.title} ${g.title}`.toLowerCase()
          if (!i.cardLinks || words.every((w) => own.includes(w))) return i
          const card = i.cardLinks.find((c) => words.every((w) => c.hay.includes(w)))
          return card ? { ...i, href: card.href } : i
        }),
    }))
    .filter((g) => g.items.length > 0)
}
