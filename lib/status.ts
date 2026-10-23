/**
 * One label + one color for every status in the app. `statusMeta(domain, value)` never throws: an unknown or
 * legacy value renders as itself in neutral (never mislabelled). Job statuses delegate to lib/job-status.ts so
 * that module stays the single owner of the job lifecycle.
 */
import { JOB_STATUS_CONFIG, jobStatusConfig, type JobStatus } from '@/lib/job-status'

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent'

export type StatusDomain =
  | 'job'
  | 'lead'
  | 'opportunity'
  | 'proposal'
  | 'appointment'
  | 'work_order'
  | 'payroll_period'
  | 'supplier_order'

type Entry = { label: string; tone: StatusTone }

const REGISTRY: Record<Exclude<StatusDomain, 'job'>, Record<string, Entry>> = {
  lead: {
    new: { label: 'New', tone: 'info' },
    contacted: { label: 'Contacted', tone: 'info' },
    appointment: { label: 'Appointment set', tone: 'accent' },
    inspection: { label: 'Inspection', tone: 'accent' },
    lost: { label: 'Lost', tone: 'neutral' },
  },
  opportunity: {
    open: { label: 'Open', tone: 'info' },
    in_progress: { label: 'In progress', tone: 'accent' },
    won: { label: 'Won', tone: 'success' },
    lost: { label: 'Lost', tone: 'neutral' },
  },
  proposal: {
    draft: { label: 'Draft', tone: 'neutral' },
    sent: { label: 'Sent', tone: 'info' },
    accepted: { label: 'Accepted', tone: 'success' },
    declined: { label: 'Declined', tone: 'danger' },
  },
  appointment: {
    scheduled: { label: 'Scheduled', tone: 'info' },
    completed: { label: 'Completed', tone: 'success' },
    no_show: { label: 'No show', tone: 'danger' },
    cancelled: { label: 'Cancelled', tone: 'neutral' },
  },
  work_order: {
    pending: { label: 'Pending', tone: 'warning' },
    scheduled: { label: 'Scheduled', tone: 'info' },
    completed: { label: 'Completed', tone: 'success' },
    cancelled: { label: 'Cancelled', tone: 'neutral' },
  },
  payroll_period: {
    open: { label: 'Open', tone: 'info' },
    locked: { label: 'Locked', tone: 'warning' },
    paid: { label: 'Paid', tone: 'success' },
  },
  supplier_order: {
    draft: { label: 'Draft', tone: 'neutral' },
    pending_approval: { label: 'Needs approval', tone: 'warning' },
    approved: { label: 'Approved', tone: 'info' },
    submitted: { label: 'Sent', tone: 'info' },
    confirmed: { label: 'Confirmed', tone: 'success' },
    failed: { label: 'Failed', tone: 'danger' },
    cancelled: { label: 'Cancelled', tone: 'neutral' },
  },
}

const JOB_TONE: Record<JobStatus, StatusTone> = {
  sold: 'info',
  materials: 'warning',
  scheduled: 'accent',
  in_progress: 'accent',
  complete: 'success',
  collected: 'neutral',
  on_hold: 'warning',
  cancelled: 'danger',
}

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

export function statusMeta(domain: StatusDomain, value: string | null | undefined): Entry {
  if (!value) return { label: 'Unknown', tone: 'neutral' }
  if (domain === 'job') {
    const known = value in JOB_STATUS_CONFIG
    return { label: jobStatusConfig(value).label, tone: known ? JOB_TONE[value as JobStatus] : 'neutral' }
  }
  return REGISTRY[domain][value] ?? { label: titleCase(value), tone: 'neutral' }
}

/** Dark text on a light tint for every tone (WCAG AA); the only place status colors are defined. */
export const TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-neutral-100 text-neutral-800 border-neutral-200',
  info: 'bg-sky-50 text-sky-900 border-sky-200',
  success: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  warning: 'bg-amber-50 text-amber-900 border-amber-300',
  danger: 'bg-red-50 text-red-900 border-red-200',
  accent: 'bg-brand-50 text-brand-900 border-brand-200',
}
