'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'

type Member = { userId: string; isLead: boolean }

/**
 * On a crew's edit screen (Settings → Subcontractors), only for a company using the time clock: is this an in-house
 * crew that clocks in, who is on it, and who leads (the lead taps for the whole crew). A sub never gets a clock.
 */
export default function CrewTimeSetup({ subId }: { subId: string }) {
  const [tracks, setTracks] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [people, setPeople] = useState<Array<{ userId: string; name: string }>>([])
  const [loaded, setLoaded] = useState<'no' | 'yes' | 'off'>('no')
  const [adding, setAdding] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void fetch(`/api/admin/subs/${subId}/crew`, { cache: 'no-store' }).then(async (r) => {
      if (!live) return
      if (!r.ok) return setLoaded('off')
      const d = (await r.json()) as { roster: { tracksTime: boolean; members: Array<Member & { name: string }> }; people: Array<{ userId: string; name: string }> }
      setTracks(d.roster.tracksTime)
      setMembers(d.roster.members.map((m) => ({ userId: m.userId, isLead: m.isLead })))
      setPeople(d.people)
      setLoaded('yes')
    })
    return () => {
      live = false
    }
  }, [subId])

  if (loaded !== 'yes') return null
  const name = (id: string) => people.find((p) => p.userId === id)?.name ?? 'Former employee'

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-[#2c2c2a] p-4 text-[#2c2c2a]">
      <label className="flex min-h-[48px] items-center gap-3 text-base">
        <input type="checkbox" className="h-6 w-6" checked={tracks} onChange={(e) => setTracks(e.target.checked)} />
        <span>
          <span className="font-semibold">Our own crew — clocks in and out</span>
          <span className="block text-sm">The crew lead taps the clock for everyone on the crew phone page. Leave off for subcontractors.</span>
        </span>
      </label>
      {tracks ? (
        <>
          <ul className="flex flex-col gap-2">
            {members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#f7f6f2] px-3 py-2 text-base">
                <span className="font-semibold">{name(m.userId)}</span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    aria-pressed={m.isLead}
                    className={`min-h-[44px] rounded-lg border-2 border-[#2c2c2a] px-3 text-base ${m.isLead ? 'bg-[#2c2c2a] text-white' : 'bg-white'}`}
                    onClick={() => setMembers(members.map((x) => (x.userId === m.userId ? { ...x, isLead: !x.isLead } : x)))}
                  >
                    {m.isLead ? 'Crew lead ✓' : 'Make lead'}
                  </button>
                  <button type="button" className="min-h-[44px] rounded-lg border-2 border-[#2c2c2a] bg-white px-3 text-base" onClick={() => setMembers(members.filter((x) => x.userId !== m.userId))}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <label className="flex flex-col gap-1 text-base font-semibold">
            Add a person
            <select
              className="min-h-[48px] rounded-lg border-2 border-[#2c2c2a] bg-white px-3 text-base"
              value={adding}
              onChange={(e) => {
                const id = e.target.value
                setAdding('')
                if (id && !members.some((m) => m.userId === id)) setMembers([...members, { userId: id, isLead: members.length === 0 }])
              }}
            >
              <option value="">Pick someone</option>
              {people
                .filter((p) => !members.some((m) => m.userId === p.userId))
                .map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.name}
                  </option>
                ))}
            </select>
            <span className="text-sm font-normal">Everyone on a crew needs a user and an hourly pay plan so their hours reach payroll.</span>
          </label>
        </>
      ) : null}
      {msg ? <p className="text-base font-semibold">{msg}</p> : null}
      <Button
        type="button"
        variant="secondary"
        className="self-start"
        loading={busy}
        onClick={async () => {
          setBusy(true)
          setMsg(null)
          const res = await fetch(`/api/admin/subs/${subId}/crew`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tracksTime: tracks, members }) }).catch(() => null)
          const out = (res ? await res.json().catch(() => ({})) : {}) as { error?: string }
          setBusy(false)
          setMsg(res && res.ok ? 'Crew saved' : out.error || 'Couldn’t save')
        }}
      >
        Save crew
      </Button>
    </div>
  )
}
