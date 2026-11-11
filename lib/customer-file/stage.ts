import type { FileTab } from '@/lib/customer-file/access'
import { BASE_TERMS, type Terms } from '@/lib/industry-profiles'

/** The company's words for the steps (lib/org-profile.ts terms; default = today's words). */
export type StageTerms = Pick<Terms, 'inspection' | 'proposal' | 'install' | 'installed'>

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

export function buildStages(i: StageInput, terms: StageTerms = BASE_TERMS): StageStep[] {
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
    ['inspection', terms.inspection, 'sales'],
    ['proposal', terms.proposal, 'sales'],
    ['signed', 'Signed', 'sales'],
    ['scheduled', 'Scheduled', 'job'],
    ['installed', terms.installed, 'job'],
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
export function nextAction(steps: StageStep[], cancelled: boolean, terms: StageTerms = BASE_TERMS): { label: string; tab: FileTab } | null {
  if (cancelled) return null
  const cur = steps.find((s) => s.state === 'current')
  if (!cur) return null
  const label: Record<string, string> = {
    lead: `Set the ${terms.inspection.toLowerCase()}`,
    inspection: `Do the ${terms.inspection.toLowerCase()}`,
    proposal: `Build the ${terms.proposal.toLowerCase()}`,
    signed: 'Get it signed',
    scheduled: `Schedule the ${terms.install.toLowerCase()}`,
    installed: `Mark ${terms.installed.toLowerCase()}`,
    paid: 'Collect payment',
    payroll: 'Send to payroll',
  }
  return { label: label[cur.key] ?? cur.label, tab: cur.tab }
}
