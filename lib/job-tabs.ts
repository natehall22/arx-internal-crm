/**
 * The job page's five tabs and which one opens first. Pure.
 *   Crews · Materials · Money · Notes · Files
 * Default = the next thing that needs doing, else the tab this person used last, else Crews:
 *   1. materials not (fully) sent on a job that still needs them  -> Materials
 *   2. a crew's last day has passed and it is not done            -> Crews
 *   3. the job is finished and money is still owed                -> Money
 */
import { crewLastDay } from '@/lib/data-health'
import type { MaterialsStateKey } from '@/lib/job-materials-state'

export const JOB_TABS = ['crews', 'materials', 'money', 'notes', 'files'] as const
export type JobTab = (typeof JOB_TABS)[number]

export const JOB_TAB_LABELS: Record<JobTab, string> = {
  crews: 'Crews',
  materials: 'Materials',
  money: 'Money',
  notes: 'Notes',
  files: 'Files',
}

export function isJobTab(v: unknown): v is JobTab {
  return (JOB_TABS as readonly string[]).includes(String(v))
}

export type DefaultTabInput = {
  jobStatus: string
  materialsKey: MaterialsStateKey
  trades: Array<{ status: string; scheduled_date: string | null; install_days: number | string | null }>
  todayYmd: string
  /** Cents still owed (contract minus payments); null when unknown or the viewer cannot see money. */
  balanceOwedCents: number | null
  /** Tabs this viewer may open (Money is hidden without job-money access). */
  allowed: ReadonlyArray<JobTab>
  lastTab?: string | null
}

const NEEDS_MATERIALS = new Set(['sold', 'materials', 'scheduled', 'in_progress'])

export function pickDefaultJobTab(i: DefaultTabInput): JobTab {
  const ok = (t: JobTab) => i.allowed.includes(t)
  if (ok('materials') && NEEDS_MATERIALS.has(i.jobStatus) && (i.materialsKey === 'not_ordered' || i.materialsKey === 'partial')) return 'materials'
  const live = i.trades.filter((t) => t.status !== 'cancelled')
  const overdue = live.some((t) => {
    const last = crewLastDay(t)
    return t.status !== 'completed' && !!last && last < i.todayYmd
  })
  if (ok('crews') && overdue && i.jobStatus !== 'cancelled' && i.jobStatus !== 'on_hold') return 'crews'
  if (ok('money') && i.jobStatus === 'complete' && (i.balanceOwedCents ?? 0) > 0) return 'money'
  if (i.lastTab && isJobTab(i.lastTab) && ok(i.lastTab)) return i.lastTab
  return ok('crews') ? 'crews' : i.allowed[0] ?? 'crews'
}

/** Which tabs show a "needs you" dot. */
export function tabsNeedingAttention(i: Omit<DefaultTabInput, 'allowed' | 'lastTab'>): JobTab[] {
  const out: JobTab[] = []
  if (NEEDS_MATERIALS.has(i.jobStatus) && (i.materialsKey === 'not_ordered' || i.materialsKey === 'partial')) out.push('materials')
  if (i.trades.some((t) => t.status !== 'cancelled' && t.status !== 'completed' && (crewLastDay(t) ?? '9999') < i.todayYmd)) out.push('crews')
  if (i.jobStatus === 'complete' && (i.balanceOwedCents ?? 0) > 0) out.push('money')
  return out
}
