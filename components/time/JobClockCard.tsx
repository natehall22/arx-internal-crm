'use client'

import { ClockHereButton, ClockPanel } from './ClockPanel'
import { useClock, usePresence } from './useClock'

/**
 * Job page "Time clock" card (company switch on): the signed-in person clocks themselves in on this job; a crew lead
 * clocks in their crew (everyone ticked; untick whoever is absent). Same taps, queue and rules as the crew phone link.
 */
export default function JobClockCard({ jobId, jobLabel }: { jobId: string; jobLabel: string }) {
  const clock = useClock('/api/time/clock')
  const [present, setPresent] = usePresence(clock)
  if (clock.loadError === 'off' || !clock.state || clock.state.people.length === 0) return null
  const crew = clock.state.people.length > 1
  return (
    <div className="flex flex-col gap-2">
      <ClockPanel
        clock={clock}
        selected={present}
        setSelected={setPresent}
        title={crew ? 'Crew time' : 'My time'}
        placeLabel={(o) => (o.jobId === jobId ? jobLabel : 'another job')}
      />
      <div className="grid grid-cols-2 gap-2">
        <ClockHereButton clock={clock} where={{ jobId }} selected={present} selfOnly={!crew} />
      </div>
    </div>
  )
}
