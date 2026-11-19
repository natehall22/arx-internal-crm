/** Which /ops/schedule view opens: Visits for a company with service plans (unless asked for Board/Calendar), else Board. */
export type ScheduleView = 'visits' | 'board' | 'calendar' | 'all'

export function scheduleViewFor(visitsOn: boolean, requested: string | undefined | null): ScheduleView {
  if (requested === 'calendar') return 'calendar'
  // The owner's big picture: only for a company with service plans (others keep Board / Calendar as they are).
  if (requested === 'all' && visitsOn) return 'all'
  if (visitsOn && requested !== 'board') return 'visits'
  return 'board'
}
