'use client'

import { DayClockCard } from './DayClockCard'
import { useClock, usePresence } from './useClock'

/**
 * The day clock for a signed-in person (Today / My day): themselves, plus every time-tracked crew they lead. Renders
 * nothing for anyone who isn’t on a crew, a role the company allowed to clock itself, or when the company has the time
 * clock off. The dashboard branch can place this component anywhere; props are optional (`viewerUserId` narrows to one person, `onPaidHours` reports paid hours today).
 */
export default function MyDayClock({ viewerUserId = null, onPaidHours }: { viewerUserId?: string | null; onPaidHours?: (hours: number) => void } = {}) {
  const clock = useClock('/api/time/clock')
  const [present, setPresent] = usePresence(clock)
  if (clock.loadError === 'off' || !clock.state || clock.state.people.length === 0) return null
  return <DayClockCard clock={clock} selected={present} setSelected={setPresent} title={clock.state.people.length > 1 && !viewerUserId ? 'Crew day' : 'My day'} viewerUserId={viewerUserId} onPaidHours={onPaidHours} />
}
