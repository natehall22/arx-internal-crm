import { redirect } from 'next/navigation'

/** Folded into Jobs → Schedule (calendar view). */
export default function ProductionCalendarRedirect() {
  redirect('/ops/schedule?view=calendar')
}
