'use client'

import { DayClockCard } from '@/components/time/DayClockCard'
import { ClockHereButton } from '@/components/time/ClockPanel'
import { useClock, usePresence } from '@/components/time/useClock'
import type { ListData } from '@/lib/dashboard-cards'

/**
 * "My day" for a crew lead or a field tech: the day clock (DayClockCard — the one time block, same taps and queue as the crew phone
 * page) above today's stops in order, each open stop with its own "Clock in here". Dark text, big targets.
 */
export default function MyDayList({ list }: { list: ListData }) {
  const clock = useClock('/api/time/clock')
  const [present, setPresent] = usePresence(clock)
  const stopLabel = (id: string | null | undefined) => list.rows.find((r) => r.id === id)?.title ?? null
  const showClock = list.clock === true && clock.loadError !== 'off' && !!clock.state && clock.state.people.length > 0
  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden sm:col-span-2 lg:col-span-4" data-card={list.key}>
      <h2 className="px-4 pt-4 pb-1 text-base sm:text-lg font-semibold text-gray-900">{list.label}</h2>
      {list.sub ? <p className="px-4 pb-2 text-sm text-gray-800">{list.sub}</p> : null}
      {showClock ? (
        <div className="px-4 pb-3">
          <DayClockCard clock={clock} selected={present} setSelected={setPresent} title={clock.state!.people.length > 1 ? 'Crew day' : 'My day'} />
        </div>
      ) : null}
      {list.failed ? (
        <p className="px-4 pb-4 text-sm text-gray-800">Couldn’t load this card.</p>
      ) : list.rows.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-gray-800">{list.empty}</p>
      ) : (
        <ol className="divide-y divide-gray-100 border-t border-gray-100">
          {list.rows.map((r) => (
            <li key={r.id} className="px-4 py-3 flex flex-col gap-2" data-stop-done={r.done ? 'true' : 'false'}>
              <p className={`text-base font-semibold ${r.done ? 'text-gray-700 line-through' : 'text-gray-900'}`}>{r.title}</p>
              {r.detail ? <p className="text-sm text-gray-800">{r.detail}</p> : null}
              {showClock && r.clockStopId ? (
                <div className="grid grid-cols-2 gap-2">
                  <ClockHereButton clock={clock} where={{ workOrderId: r.clockStopId }} selected={present} />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
