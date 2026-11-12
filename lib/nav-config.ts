/**
 * The ONE place that decides what the app navigation shows. Six sections (Today · Pipeline · Jobs · Customers ·
 * Money · Insights) plus Canvass and Settings; each section lists the existing pages it contains, and every page keeps
 * exactly the permission test the old flat nav used — so nobody gains or loses a page, they just find it in one place.
 * Pure (no React, no fetching): Nav.tsx builds the context from the same permission helpers it always used.
 */
import type { OrgFeature, OrgFeatures } from '@/lib/org-features'
import type { NavSectionId, Terms } from '@/lib/industry-profiles'

export type NavContext = {
  /** Permissions loaded and (for non-superusers) known. While false, permission-gated items stay hidden (fail closed). */
  permsReady: boolean
  role: string | null
  fullAccess: boolean
  permissionNames: ReadonlySet<string>
  /** Company feature switches (lib/org-features.ts). Missing = every feature on. */
  features?: Partial<OrgFeatures>
  /**
   * The company's industry profile (lib/org-profile.ts): section order, pages it hides and its words. Missing = roofing =
   * today's order and labels. Hiding only removes a menu entry; the page keeps its own permission gate.
   */
  profile?: { nav: { order: readonly NavSectionId[]; hidden: readonly string[] }; terms: Pick<Terms, 'jobs' | 'jobBoard'> }
  /** Helper results computed with lib/permissions (kept out of this file so there is one definition of each). */
  flags: {
    isOpsOnly: boolean
    canSeeOpsDashboard: boolean
    canSeeJobBoard: boolean
    canSeeInsideSales: boolean
    projectsBarred: boolean
    salesDocBarred: boolean
    customerRecords: boolean
    reports: boolean
    isPayrollAdmin: boolean
    /** A commission/hourly role: sees "My pay". */
    earnsPay: boolean
    /** PAYROLL_PAY_WEEK_ENABLED: the new payroll screens (My pay) exist. */
    payWeek: boolean
  }
}

/** A company feature switch is on (missing / unknown = on, like lib/org-features.ts). */
const featureOn = (c: NavContext, f: OrgFeature) => c.features?.[f] !== false

export type NavLeaf = { href: string; label: string; show: (c: NavContext) => boolean }
export type NavSection = {
  id: NavSectionId
  label: string
  /** Where the section's own link goes (the first visible child, unless fixed here). */
  href?: string
  children: NavLeaf[]
}

const has = (c: NavContext, ...names: string[]) => c.fullAccess || names.some((n) => c.permissionNames.has(n))
/** A gated item: hidden until permissions are ready, then any-of. */
const gated = (...names: string[]) => (c: NavContext) => c.permsReady && has(c, ...names)

const SCHEDULING = ['scheduling:view', 'scheduling:create', 'scheduling:edit', 'scheduling:manage_team', 'scheduling:manage_region', 'scheduling:manage_queue']
const LEADS = ['leads:view', 'leads:create', 'leads:edit', 'leads:delete', 'leads:assign', 'leads:view_inbound', 'leads:manage_inbound', 'leads:claim_inbound']
const REPORTS = ['reports:view_own', 'reports:view_team', 'reports:view_region', 'reports:view_all']

export const NAV_SECTIONS: NavSection[] = [
  { id: 'today', label: 'Today', href: '/today', children: [] },
  {
    id: 'pipeline',
    label: 'Pipeline',
    children: [
      { href: '/leads', label: 'Leads', show: gated(...LEADS) },
      {
        href: '/opportunities',
        label: 'Opportunities',
        show: (c) => gated('opportunities:view', 'opportunities:edit')(c) && c.role !== 'setter' && c.role !== 'canvasser',
      },
      { href: '/inside-sales', label: 'Inside Sales', show: (c) => c.flags.canSeeInsideSales },
      { href: '/appointments', label: 'Appointments', show: gated(...SCHEDULING) },
      { href: '/referral-partners', label: 'Referral Partners', show: gated('referral_partners:view') },
    ],
  },
  {
    id: 'jobs',
    label: 'Jobs',
    children: [
      { href: '/ops', label: 'Job Board', show: (c) => c.flags.canSeeJobBoard && gated('jobs:view', 'jobs:edit')(c) },
      { href: '/ops/schedule', label: 'Schedule', show: (c) => c.flags.canSeeJobBoard && gated('jobs:view', 'jobs:edit')(c) },
      { href: '/ops/checkups', label: 'Checkups', show: (c) => c.flags.canSeeJobBoard && gated('jobs:view', 'jobs:edit')(c) },
      { href: '/ops/dashboard', label: 'Needs you', show: (c) => c.flags.canSeeOpsDashboard && gated('ops:dashboard:view', 'jobs:view', 'jobs:edit')(c) },
      { href: '/projects', label: 'Projects', show: (c) => !c.flags.projectsBarred && gated('projects:view', 'projects:edit')(c) },
    ],
  },
  {
    id: 'customers',
    label: 'Customers',
    children: [
      { href: '/customers', label: 'Customers', show: (c) => c.permsReady && (has(c, 'customers:view', 'customers:edit') || c.flags.customerRecords) },
      { href: '/signing', label: 'Signatures', show: (c) => c.permsReady && !c.flags.salesDocBarred && gated('contracts:send', 'contracts:view')(c) },
    ],
  },
  {
    id: 'money',
    label: 'Money',
    children: [
      { href: '/my-pay', label: 'My pay', show: (c) => c.permsReady && c.flags.payWeek && c.flags.earnsPay },
      { href: '/billing', label: 'Billing', show: gated('money:record') },
      { href: '/admin/payroll', label: 'Payroll', show: (c) => c.permsReady && c.flags.isPayrollAdmin },
      // Default-OFF switch: shown only once the features have loaded and say on (never on a missing map).
      { href: '/admin/time', label: 'Time', show: (c) => c.permsReady && c.flags.isPayrollAdmin && c.features?.timeTracking === true },
      { href: '/admin/job-profit-tracker', label: 'Job profit', show: (c) => c.permsReady && c.flags.isPayrollAdmin },
      { href: '/pricebook', label: 'Pricebook', show: (c) => !c.flags.salesDocBarred && gated('pricebook:view', 'pricebook:edit')(c) },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    children: [
      { href: '/dashboard', label: 'Dashboard', show: (c) => !c.flags.isOpsOnly },
      { href: '/reports', label: 'Reports', show: (c) => c.permsReady && (has(c, ...REPORTS) || c.flags.reports) },
      { href: '/sisu', label: 'Incentives', show: (c) => featureOn(c, 'incentives') && gated('leads:view')(c) },
    ],
  },
]

export const CANVASS_ITEM: NavLeaf = { href: '/canvass', label: 'Canvass', show: (c) => featureOn(c, 'canvassing') && gated('canvass:view')(c) }
export const ADMIN_ITEM: NavLeaf = {
  href: '/admin',
  label: 'Admin',
  show: gated('admin:full', 'admin:access', 'admin:roles', 'admin:permissions', 'admin:settings'),
}

export type VisibleSection = { id: NavSection['id']; label: string; href: string; children: Array<{ href: string; label: string }> }

/** Profile words on the menu: the Jobs section and its board link (roofing = "Jobs" / "Job Board", unchanged). */
function profileLabel(c: NavContext, key: string, fallback: string): string {
  const terms = c.profile?.terms
  if (!terms) return fallback
  if (key === 'section:jobs') return terms.jobs
  if (key === '/ops') return terms.jobBoard
  return fallback
}

/** Sections this person sees, each with only its visible pages. A section with no visible page disappears. */
export function visibleNav(c: NavContext): { sections: VisibleSection[]; canvass: boolean; admin: boolean } {
  const sections: VisibleSection[] = []
  const hidden = new Set(c.profile?.nav.hidden ?? [])
  for (const s of NAV_SECTIONS) {
    const children = s.children
      .filter((l) => !hidden.has(l.href) && l.show(c))
      .map(({ href, label }) => ({ href, label: profileLabel(c, href, label) }))
    if (s.children.length > 0 && children.length === 0) continue
    sections.push({ id: s.id, label: profileLabel(c, `section:${s.id}`, s.label), href: s.href ?? children[0].href, children })
  }
  const order = c.profile?.nav.order ?? []
  const rank = (id: NavSectionId) => {
    const i = order.indexOf(id)
    return i === -1 ? order.length : i
  }
  sections.sort((a, b) => rank(a.id) - rank(b.id) || NAV_SECTIONS.findIndex((s) => s.id === a.id) - NAV_SECTIONS.findIndex((s) => s.id === b.id))
  return { sections, canvass: CANVASS_ITEM.show(c), admin: ADMIN_ITEM.show(c) }
}

/** Which section a pathname belongs to (longest matching page wins), for the active highlight. */
export function activeSectionId(pathname: string | null | undefined, nav: { sections: VisibleSection[] }): VisibleSection['id'] | null {
  if (!pathname) return null
  let best: { id: VisibleSection['id']; len: number } | null = null
  for (const s of nav.sections) {
    for (const href of [s.href, ...s.children.map((c) => c.href)]) {
      if ((pathname === href || pathname.startsWith(href + '/')) && (!best || href.length > best.len)) best = { id: s.id, len: href.length }
    }
  }
  return best?.id ?? null
}
