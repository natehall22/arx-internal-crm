import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui'
import type { CustomerTextingState } from '@/lib/sms/customer-state'

const day = (iso: string): string => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** Customer File → Texting: can we text them, the proof of their OK, and the last texts. Read-only (server rendered). */
export default function TextingCard({ state }: { state: CustomerTextingState }) {
  const s = state.status
  const headline =
    s.state === 'ready'
      ? `OK to text ${s.masked}`
      : s.message
  return (
    <Card>
      <CardHeader>
        <CardTitle>Texting</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-ui-base font-semibold text-ink">{headline}</p>
        {state.consent.length > 0 ? (
          <div>
            <p className="text-ui-sm font-semibold text-ink">Proof of their OK</p>
            <ul className="divide-y divide-surface-line">
              {state.consent.map((c) => (
                <li key={c.id} className="py-2 text-ui-base text-ink">
                  {c.granted ? c.how : `${c.how} — texts stopped`}
                  {c.by ? ` · recorded by ${c.by}` : ''} · {day(c.at)}
                  {c.granted && c.wording ? ` · wording ${c.wording}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-ui-sm text-ink">No OK to text on file yet. It is recorded when you text them for the first time.</p>
        )}
        {state.recent.length > 0 ? (
          <ul className="divide-y divide-surface-line">
            {state.recent.map((r) => (
              <li key={`${r.direction}-${r.id}`} className="flex flex-wrap justify-between gap-2 py-2 text-ui-base text-ink">
                <span>{r.label}</span>
                <span>
                  {r.detail ? `${r.detail} · ` : ''}
                  {day(r.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}
