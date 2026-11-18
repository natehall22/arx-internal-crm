/** Which /ops/schedule view opens: Visits for a company with service plans (unless asked for Board/Calendar), else Board. */
export type ScheduleView = 'visits' | 'board' | 'calendar'

export function scheduleViewFor(visitsOn: boolean, requested: string | undefined | null): ScheduleView {
  if (requested === 'calendar') return 'calendar'
  if (visitsOn && requested !== 'board') return 'visits'
  return 'board'
}
