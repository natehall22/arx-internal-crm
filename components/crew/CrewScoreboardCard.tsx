import type { Scoreboard } from '@/lib/crew-incentives-db'

const dollars = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`

/**
 * This week's crew bonuses: earned (approved) and pending per person, and progress to the weekly target. Shows only the
 * crews it was given (the server decides whose), and a dollar target as a percent, never as job money.
 */
export default function CrewScoreboardCard({ data }: { data: Scoreboard }) {
  if (data.crews.length === 0) return null
  return (
    <section aria-label="Crew bonuses this week" className="rounded-xl border border-[#e5e3dc] bg-white p-4 text-[#2c2c2a]">
      <h2 className="text-lg font-bold">Crew bonuses this week</h2>
      <p className="text-base">Week ending {data.weekEnding}. Pending bonuses are waiting on approval.</p>
      {data.crews.map((c) => (
        <div key={c.subId} className="mt-3">
          {data.crews.length > 1 ? <h3 className="text-base font-semibold">{c.name}</h3> : null}
          {c.target ? (
            <div className="mt-1">
              <p className="text-base font-semibold">
                {c.target.hit ? 'Weekly target hit' : 'Weekly target'}
                {c.target.basis === 'visits' ? `: ${c.target.done} of ${c.target.goal} visits` : `: ${c.target.percent}% of the way`} · {dollars(c.target.amount)} for the crew
              </p>
              <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-[#e5e3dc]" role="progressbar" aria-valuenow={c.target.percent} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-[#1f6f43]" style={{ width: `${c.target.percent}%` }} />
              </div>
            </div>
          ) : null}
          <ul className="mt-2 divide-y divide-[#e5e3dc]">
            {c.people.map((p) => (
              <li key={p.userId} className="flex min-h-[44px] items-center justify-between gap-3 py-2 text-base">
                <span className="font-semibold">{p.name}{p.isMe ? ' (you)' : ''}</span>
                <span className="text-right">
                  <span className="block">Earned {dollars(p.earned)}</span>
                  <span className="block text-sm">Pending {dollars(p.pending)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
