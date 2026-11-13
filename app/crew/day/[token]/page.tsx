import type { Metadata } from 'next'
import { cache } from 'react'

import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { getDocumentBrand } from '@/lib/org-brand'
import { activeCrewDay } from '@/lib/service-plans-access'
import { SERVICE_STEP, ymdInZone } from '@/lib/service-plans'
import { loadVisits } from '@/lib/service-plans-db'
import { loadCrewMoney } from '@/lib/visit-collections-db'
import type { CrewMoney } from '@/lib/visit-collections'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { loadClockState } from '@/lib/time-tracking-db'
import { createServiceClient } from '@/lib/supabase/service'
import { readCustomerMessageSettings } from '@/lib/customer-messages'
import { loadScoreboard } from '@/lib/crew-incentives-db'
import CrewDayList from './CrewDayList'

export const dynamic = 'force-dynamic'

const loadCrewDay = cache(async (token: string) => {
  const admin = createServiceClient()
  const crew = await activeCrewDay(admin, token)
  const brand = await getDocumentBrand(admin, crew?.orgId ?? null)
  return { admin, crew, brand }
})

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const { brand } = await loadCrewDay(params.token)
  return { title: `Today’s visits — ${brand.casualName}`, robots: { index: false, follow: false }, referrer: 'no-referrer' }
}

/**
 * A crew's phone list of today's service visits (no login; the link IS the key — lib/service-plans-db.ts
 * resolveCrewDay). In stop order, with the address, a directions link and the gate / access notes; mark each done
 * (with photos) or skipped with a reason. Only this crew's visits, only today (yesterday's can still be closed).
 */
export default async function CrewDayPage({ params }: { params: { token: string } }) {
  const { admin, crew, brand } = await loadCrewDay(params.token)
  if (!crew) {
    return (
      <main className="min-h-screen bg-[#f7f6f2] px-4 py-10">
        <div className="mx-auto max-w-md rounded-xl border border-[#e5e3dc] bg-white p-6 text-center">
          <h1 className="text-xl font-bold text-[#2c2c2a]">This link isn’t active</h1>
          <p className="mt-2 text-base text-[#2c2c2a]">{`Ask ${brand.shortName} for a new link.`}</p>
        </div>
      </main>
    )
  }
  const today = ymdInZone(new Date(), await loadOrgTimeZone(admin, crew.orgId))
  const visits = (await loadVisits(admin, crew.orgId, { from: today, to: today, subId: crew.subId, accessNotes: true })).filter((v) => v.status !== 'cancelled')
  // What each customer still owes (one number; never a price line). A failed read just shows no money, never breaks the list.
  const money = await loadCrewMoney(admin, crew.orgId, visits.filter((v) => v.status !== 'skipped').map((v) => ({ id: v.id, customerId: v.customerId }))).catch((e) => {
    console.error('[crew-day] money load failed', e)
    return {} as Record<string, CrewMoney>
  })
  // The crew's time clock: only for a company using it and a crew that clocks in (subs never see a clock).
  const clock = (await isOrgFeatureOn(crew.orgId, 'timeTracking'))
    ? await loadClockState(admin, { via: 'crew_link', orgId: crew.orgId, subId: crew.subId }).catch((e) => {
        console.error('[crew-day] clock load failed', e)
        return null
      })
    : null
  // "On my way" button: only when the company sends that email (Settings → Customer messages).
  const onTheWay =
    (await isOrgFeatureOn(crew.orgId, 'customerMessages')) &&
    readCustomerMessageSettings(((await admin.from('orgs').select('cm:settings->customerMessages').eq('id', crew.orgId).maybeSingle()).data as { cm?: unknown } | null)?.cm).onTheWay
  // Crew incentives: this crew's own bonuses (null unless a lawn_landscape company turned them on).
  const scoreboard = await loadScoreboard(admin, crew.orgId, { subId: crew.subId }).catch((e) => {
    console.error('[crew-day] scoreboard failed', e)
    return null
  })
  return (
    <CrewDayList
      scoreboard={scoreboard}
      token={params.token}
      onTheWay={onTheWay}
      crewName={crew.crewName}
      companyName={brand.casualName}
      today={today}
      clock={clock && clock.people.length > 0 ? clock : null}
      visits={visits.map((v) => ({
        id: v.id,
        planName: v.step !== SERVICE_STEP && v.stepLabel ? `${v.stepLabel} — ${v.planName}` : v.planName,
        resultOptions: v.resultOptions,
        address: v.address,
        lat: v.lat,
        lng: v.lng,
        // Gate codes only for visits still to do: a finished stop has no reason to keep showing them.
        accessNotes: v.status === 'scheduled' ? v.accessNotes : null,
        status: v.status,
        skipReason: v.skipReason,
        photoCount: v.photoCount,
        routePosition: v.routePosition,
        officeNotes: v.status === 'scheduled' ? v.officeNotes : null,
        checklist: v.checklist,
        money: money[v.id] ?? null,
      }))}
    />
  )
}
