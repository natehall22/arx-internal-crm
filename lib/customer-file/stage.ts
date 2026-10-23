import type { FileTab } from '@/lib/customer-file/access'

/** The progress stepper in the file header. Clicking a step jumps to the tab that owns it. */
export type StageInput = {
  inspectionSet: boolean
  hasProposal: boolean
  signed: boolean
  job: null | {
    status: string
    scheduled: boolean
    completed: boolean
    paid: boolean
    payrollSent: boolean
    cancelled: boolean
  }
}

export type StageStep = { key: string; label: string; tab: FileTab; state: 'done' | 'current' | 'todo' }

export function buildStages(i: StageInput): StageStep[] {
  const j = i.job
  const done = [
    true,
    i.inspectionSet,
    i.hasProposal,
    i.signed,
    !!j && j.scheduled && !j.cancelled,
    !!j && j.completed,
    !!j && j.paid,
    !!j && j.payrollSent,
  ]
  const defs: Array<[string, string, FileTab]> = [
    ['lead', 'Lead', 'sales'],
    ['inspection', 'Inspection', 'sales'],
    ['proposal', 'Proposal', 'sales'],
    ['signed', 'Signed', 'sales'],
    ['scheduled', 'Scheduled', 'job'],
    ['installed', 'Installed', 'job'],
    ['paid', 'Paid', 'money'],
    ['payroll', 'Payroll', 'money'],
  ]
  // The current step is the first one not done.
  const firstOpen = done.findIndex((d) => !d)
  return defs.map(([key, label, tab], idx) => ({
    key,
    label,
    tab,
    state: done[idx] ? 'done' : idx === firstOpen ? 'current' : 'todo',
  }))
}

/** "Schedule ▸"-style next action for the header, by what's open. */
export function nextAction(steps: StageStep[], cancelled: boolean): { label: string; tab: FileTab } | null {
  if (cancelled) return null
  const cur = steps.find((s) => s.state === 'current')
  if (!cur) return null
  const label: Record<string, string> = {
    lead: 'Set the inspection',
    inspection: 'Do the inspection',
    proposal: 'Build the proposal',
    signed: 'Get it signed',
    scheduled: 'Schedule the install',
    installed: 'Mark installed',
    paid: 'Collect payment',
    payroll: 'Send to payroll',
  }
  return { label: label[cur.key] ?? cur.label, tab: cur.tab }
}
