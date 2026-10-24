import { isFieldRole, type ThreadViewer } from '@/lib/threads/visibility'

/**
 * Customer File tabs + who lands where. Pure and client-safe; permission-shaped (no role-slug
 * checks beyond the ThreadViewer flags the one resolver computes).
 */
export const FILE_TABS = ['overview', 'sales', 'job', 'money', 'files', 'notes'] as const
export type FileTab = (typeof FILE_TABS)[number]

export const TAB_LABELS: Record<FileTab, string> = {
  overview: 'Overview',
  sales: 'Sales',
  job: 'Job',
  money: 'Money',
  files: 'Files',
  notes: 'Notes',
}

export function isFileTab(v: string): v is FileTab {
  return (FILE_TABS as readonly string[]).includes(v)
}

export type FileAccessInput = { hasJob: boolean }

/** The tabs this viewer may open on this deal. "notes" is the mobile home of the thread (the desktop rail covers it). */
export function tabsFor(v: ThreadViewer, input: FileAccessInput): FileTab[] {
  // The Sales tab is the opportunity page, which 404s for setters and canvassers (their home is the canvass app; a read-limited
  // setter view is not built). Until it is, they are not offered a tab that leads to a "not found" page.
  const tabs: FileTab[] = v.setterLike && !v.insideSales ? ['overview'] : ['overview', 'sales']
  // The Job tab is the existing job page, which itself requires job-board access.
  // Field roles (setters, canvassers, inside sales) never get Job or Money, even with a custom grant: deny first.
  const field = isFieldRole(v)
  if (input.hasJob && !field && (v.ownerLike || v.jobBoard)) tabs.push('job')
  if (input.hasJob && !field && (v.ownerLike || v.jobFinancials)) tabs.push('money')
  // Contracts and pricing PDFs live in Files: pricing-barred roles (setters, inside sales) don't get it.
  if (!v.pricingBarred) tabs.push('files')
  tabs.push('notes')
  return tabs
}

/** Role default (customer-file spec §3.3); a remembered last tab wins when still allowed. */
export function defaultTab(v: ThreadViewer, input: FileAccessInput, remembered?: string | null): FileTab {
  const allowed = tabsFor(v, input)
  if (remembered && isFileTab(remembered) && remembered !== 'notes' && allowed.includes(remembered)) return remembered
  const pick = (t: FileTab): FileTab => (allowed.includes(t) ? t : 'overview')
  if (v.ownerLike) return 'overview'
  if (v.jobBoard && !v.managerLike) return pick('job') // ops
  if (v.managerLike) return v.jobBoard && !v.closerLike ? pick('job') : 'sales'
  if (v.closerLike) return 'sales'
  if (v.setterLike) return 'overview'
  return 'sales' // inside sales: follow-up panel lives on the Sales tab
}
