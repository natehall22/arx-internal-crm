'use client'

import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import type { RoofRadarProperty, RoofRadarScore, RoofRadarStormExposure } from '@/lib/roofradar'

type Score = RoofRadarScore
type ListingStatus = 'sold' | 'pending' | 'active' | 'contingent'
type RadarProperty = RoofRadarProperty
type StormExposure = RoofRadarStormExposure

type SourceStatus = {
  key: string
  label: string
  provider: string
  configured: boolean
  cadence: string
  note: string
}

const STREETS = [
  'Maple Creek Dr',
  'Blue Ridge Pkwy',
  'Cabarrus Ave E',
  'Old Concord Rd',
  'Harris Rd',
  'Poplar Tent Rd',
  'Rocky River Rd',
  'Lake Concord Rd',
  'Kannapolis Pkwy',
  'George W Liles Pkwy',
  'Copperfield Blvd',
  'Flowes Store Rd',
]

const CITIES = [
  { label: 'Kannapolis, NC', zip: '28081', lat: 35.4874, lng: -80.6217 },
  { label: 'Kannapolis, NC', zip: '28082', lat: 35.5017, lng: -80.6546 },
  { label: 'Concord, NC', zip: '28027', lat: 35.4039, lng: -80.6666 },
  { label: 'Concord, NC', zip: '28025', lat: 35.3871, lng: -80.5321 },
  { label: 'Harrisburg, NC', zip: '28036', lat: 35.3235, lng: -80.6559 },
  { label: 'Mt Pleasant, NC', zip: '28124', lat: 35.3993, lng: -80.4353 },
]

const SIGNALS = [
  'Age 20+ yrs',
  'No roof permit found',
  'Storm exposure',
  'Visible shingle wear',
  'Listing says as-is',
  'Estate sale',
  'Prior claim signal',
  'Moss or algae growth',
]

const scoreRank: Score[] = ['A', 'B', 'C', 'D']

const rnd = (min: number, max: number, seed: number) => {
  const x = Math.sin(seed * 999) * 10000
  return Math.floor((x - Math.floor(x)) * (max - min + 1)) + min
}

const scoreFrom = (roofAge: number, signalCount: number, storm: StormExposure): Score => {
  const stormPressure =
    storm.hailEvents * 12 +
    storm.windEvents * 7 +
    Math.max(0, storm.maxHailInches - 0.75) * 18 +
    Math.max(0, storm.maxWindMph - 45) * 0.9 +
    (storm.lastEventDaysAgo <= 45 ? 12 : storm.lastEventDaysAgo <= 120 ? 6 : 0)
  const total = Math.min(35, roofAge) * 2.2 + signalCount * 12 + stormPressure
  if (total >= 75) return 'A'
  if (total >= 48) return 'B'
  if (total >= 25) return 'C'
  return 'D'
}

const makeStormExposure = (seed: number): StormExposure => {
  const hailEvents = rnd(0, 4, seed + 20)
  const windEvents = rnd(0, 6, seed + 21)
  const maxHailTenths = hailEvents > 0 ? rnd(7, 24, seed + 22) : 0
  const maxWindMph = windEvents > 0 ? rnd(38, 78, seed + 23) : rnd(18, 42, seed + 23)
  const lastEventDaysAgo = hailEvents + windEvents > 0 ? rnd(4, 730, seed + 24) : rnd(731, 1300, seed + 24)
  const confidence =
    hailEvents > 1 || windEvents > 3 || maxWindMph >= 58 || maxHailTenths >= 10
      ? 'High'
      : hailEvents > 0 || windEvents > 1
        ? 'Medium'
        : 'Low'

  return {
    hailEvents,
    maxHailInches: Number((maxHailTenths / 10).toFixed(1)),
    windEvents,
    maxWindMph,
    lastEventDaysAgo,
    confidence,
  }
}

const makeDataset = (search: string): RadarProperty[] => {
  const base = search
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), 0)

  return Array.from({ length: 126 }, (_, index) => {
    const seed = base + index + 1
    const market = CITIES[rnd(0, CITIES.length - 1, seed)]
    const street = `${rnd(100, 9999, seed + 2)} ${STREETS[rnd(0, STREETS.length - 1, seed + 3)]}`
    const roofAge = rnd(0, 42, seed + 4)
    const storm = makeStormExposure(seed)
    const signalCount = roofAge >= 22 ? rnd(4, 7, seed + 5) : roofAge >= 15 ? rnd(2, 5, seed + 5) : rnd(0, 2, seed + 5)
    const signals = [...SIGNALS].sort((a, b) => (rnd(0, 100, seed + a.length) > rnd(0, 100, seed + b.length) ? 1 : -1)).slice(0, signalCount)
    if (storm.hailEvents > 0 && !signals.includes('Storm exposure')) signals.unshift('Storm exposure')
    if (storm.maxWindMph >= 58 && !signals.includes('Wind event 58+ mph')) signals.unshift('Wind event 58+ mph')
    if (storm.maxHailInches >= 1 && !signals.includes('Hail 1 inch+ nearby')) signals.unshift('Hail 1 inch+ nearby')

    return {
      id: index,
      street,
      city: market.label,
      zip: market.zip,
      lat: Number((market.lat + rnd(-40, 40, seed + 30) / 10000).toFixed(6)),
      lng: Number((market.lng + rnd(-40, 40, seed + 31) / 10000).toFixed(6)),
      status: (['sold', 'sold', 'pending', 'pending', 'active', 'contingent'] as ListingStatus[])[
        rnd(0, 5, seed + 6)
      ],
      score: scoreFrom(roofAge, signals.length, storm),
      roofAge,
      yearBuilt: rnd(1952, 2014, seed + 7),
      value: rnd(140, 720, seed + 8) * 1000,
      sqft: rnd(1050, 4400, seed + 9),
      daysAgo: rnd(1, 130, seed + 10),
      source: rnd(0, 1, seed + 11) === 0 ? 'Redfin' : 'Zillow',
      signals,
      storm,
      tagged: false,
      notes: '',
    }
  })
}

export default function RoofRadarClient() {
  const [search, setSearch] = useState('28081')
  const [properties, setProperties] = useState<RadarProperty[]>(() => makeDataset('28081'))
  const [dataMode, setDataMode] = useState<'demo' | 'live'>('demo')
  const [scanMessage, setScanMessage] = useState('Demo data loaded. Configure a listing provider to scan live feeds.')
  const [isScanning, setIsScanning] = useState(false)
  const [sources, setSources] = useState<SourceStatus[]>([])
  const [statuses, setStatuses] = useState<Set<ListingStatus>>(new Set<ListingStatus>(['sold', 'pending']))
  const [scores, setScores] = useState<Set<Score>>(new Set<Score>(['A', 'B', 'C']))
  const [ageMin, setAgeMin] = useState(12)
  const [daysMax, setDaysMax] = useState(90)
  const [view, setView] = useState<'grid' | 'list' | 'map'>('grid')
  const [activeProperty, setActiveProperty] = useState<RadarProperty | null>(null)

  const filtered = useMemo(
    () =>
      properties
        .filter((property) => statuses.has(property.status))
        .filter((property) => scores.has(property.score))
        .filter((property) => property.roofAge >= ageMin)
        .filter((property) => property.daysAgo <= daysMax)
        .sort((a, b) => scoreRank.indexOf(a.score) - scoreRank.indexOf(b.score) || b.roofAge - a.roofAge),
    [ageMin, daysMax, properties, scores, statuses]
  )

  const tagged = properties.filter((property) => property.tagged)
  const priorityA = filtered.filter((property) => property.score === 'A').length
  const zipCount = new Set(filtered.map((property) => property.zip)).size
  const stormHits = filtered.filter(
    (property) => property.storm.hailEvents > 0 || property.storm.maxWindMph >= 58
  ).length

  useEffect(() => {
    let alive = true
    fetch('/api/admin/roofradar/sources', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (!alive) return
        if (payload && Array.isArray(payload.sources)) setSources(payload.sources)
      })
      .catch(() => {
        if (alive) setSources([])
      })
    return () => {
      alive = false
    }
  }, [])

  const toggleStatus = (status: ListingStatus) => {
    setStatuses((current) => {
      const next = new Set(current)
      if (next.has(status) && next.size > 1) next.delete(status)
      else next.add(status)
      return next
    })
  }

  const toggleScore = (score: Score) => {
    setScores((current) => {
      const next = new Set(current)
      if (next.has(score) && next.size > 1) next.delete(score)
      else next.add(score)
      return next
    })
  }

  const applyPath = (path: 'storm' | 'pending' | 'aged' | 'route') => {
    if (path === 'storm') {
      setStatuses(new Set<ListingStatus>(['sold', 'pending', 'active']))
      setScores(new Set<Score>(['A', 'B']))
      setAgeMin(10)
      setDaysMax(120)
      setView('grid')
    }
    if (path === 'pending') {
      setStatuses(new Set<ListingStatus>(['pending', 'contingent']))
      setScores(new Set<Score>(['A', 'B', 'C']))
      setAgeMin(8)
      setDaysMax(90)
      setView('list')
    }
    if (path === 'aged') {
      setStatuses(new Set<ListingStatus>(['sold', 'pending', 'active']))
      setScores(new Set<Score>(['A', 'B', 'C']))
      setAgeMin(18)
      setDaysMax(180)
      setView('grid')
    }
    if (path === 'route') {
      setStatuses(new Set<ListingStatus>(['sold', 'pending']))
      setScores(new Set<Score>(['A', 'B']))
      setAgeMin(12)
      setDaysMax(90)
      setView('map')
    }
  }

  const toggleTagged = (id: RadarProperty['id']) => {
    setProperties((current) =>
      current.map((property) => (property.id === id ? { ...property, tagged: !property.tagged } : property))
    )
  }

  const updateNotes = (id: RadarProperty['id'], notes: string) => {
    setProperties((current) => current.map((property) => (property.id === id ? { ...property, notes } : property)))
    setActiveProperty((current) => (current && current.id === id ? { ...current, notes } : current))
  }

  const scan = async () => {
    const query = search.trim() || '28081'
    setIsScanning(true)
    setScanMessage('Scanning configured live listing feed...')
    try {
      const response = await fetch('/api/admin/roofradar/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const payload = await response.json().catch(() => null)
      if (response.ok && payload && Array.isArray(payload.properties)) {
        setProperties(payload.properties)
        setDataMode('live')
        const geocoder = payload.openData?.geocoder
        const storm = payload.openData?.storm
        const freeDataNote =
          geocoder || storm
            ? ` Free data: ${storm?.provider || 'storm adapter'} matched within ${storm?.radiusMiles || 8}mi; ${geocoder?.matched || 0}/${geocoder?.attempted || 0} Census geocodes matched.`
            : ''
        setScanMessage(`Loaded ${payload.properties.length} live records from ${payload.provider || 'provider'}.${freeDataNote}`)
      } else {
        setProperties(makeDataset(query))
        setDataMode('demo')
        setScanMessage(
          payload?.details ||
            payload?.error ||
            'Live provider unavailable. Showing deterministic demo records for this search.'
        )
      }
    } catch {
      setProperties(makeDataset(query))
      setDataMode('demo')
      setScanMessage('Live provider request failed. Showing deterministic demo records for this search.')
    } finally {
      setIsScanning(false)
      setActiveProperty(null)
    }
  }

  const exportCsv = (rows: RadarProperty[], filename: string) => {
    const headers = [
      'Address',
      'City',
      'ZIP',
      'Status',
      'Score',
      'Roof Age',
      'Year Built',
      'Value',
      'Sq Ft',
      'Source',
      'Hail Events',
      'Max Hail Inches',
      'Wind Events',
      'Max Wind MPH',
      'Last Storm Days Ago',
      'Storm Confidence',
      'Signals',
      'Notes',
    ]
    const csvRows = rows.map((property) => [
      property.street,
      property.city,
      property.zip,
      property.status,
      property.score,
      property.roofAge,
      property.yearBuilt,
      property.value,
      property.sqft,
      property.source,
      property.storm.hailEvents,
      property.storm.maxHailInches,
      property.storm.windEvents,
      property.storm.maxWindMph,
      property.storm.lastEventDaysAgo,
      property.storm.confidence,
      property.signals.join(' | '),
      property.notes.replaceAll(',', ';'),
    ])
    const csv = [headers, ...csvRows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="rr-app min-h-screen bg-[#061221] text-slate-100">
      <header className="rr-header">
        <div className="rr-brand">
          <div className="rr-brand-main">ARX</div>
          <div className="rr-brand-sub">RoofRadar™</div>
        </div>
        <div className={`rr-live ${dataMode === 'live' ? 'is-live' : 'is-demo'}`}>
          <span />
          {dataMode === 'live' ? 'Live Data' : 'Demo Data'}
        </div>
        <div className="rr-kpis">
            <Kpi label="Properties" value={filtered.length} />
            <Kpi label="Priority A" value={priorityA} />
            <Kpi label="Tagged" value={tagged.length} />
            <Kpi label="ZIP Codes" value={zipCount} />
        </div>
        <button type="button" className="rr-api-btn" onClick={() => setScanMessage('Provider settings are managed by server env for now.')}>
          <span>⊙</span>
          API Settings
        </button>
      </header>

      <div className="rr-body">
        <aside className="rr-sidebar">
          <div>
            <Panel title="Search Area">
              <div className="rr-search">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="rr-search-input"
                  placeholder="ZIP, city, or county"
                />
                <button
                  onClick={scan}
                  disabled={isScanning}
                  className="rr-scan-btn"
                >
                  {isScanning ? 'Scanning' : '▶ Scan'}
                </button>
              </div>
              <p className="rr-muted-copy">
                Listing rows require an approved feed · free storm history via <strong>NOAA/SPC</strong> · geocoding via <strong>US Census</strong>
              </p>
            </Panel>

            <Panel title="Data Sources">
              <div className="rr-source-row">
                {(sources.length ? sources : DEFAULT_SOURCES).slice(0, 5).map((source) => (
                  <div
                    key={source.key}
                    className={`rr-source-pill ${source.configured ? 'on' : ''}`}
                    title={source.note}
                  >
                    <span />
                    {source.label.replace('Listing Feed', 'Listings').replace('Storm History', 'Storms')}
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Rep Paths">
              <div className="rr-path-grid">
                <PathButton
                  title="Storm-hit movers"
                  sub="Hail/wind + active market"
                  onClick={() => applyPath('storm')}
                />
                <PathButton
                  title="Pending closings"
                  sub="Buyer/seller timing"
                  onClick={() => applyPath('pending')}
                />
                <PathButton
                  title="Old roof targets"
                  sub="Aged roof + activity"
                  onClick={() => applyPath('aged')}
                />
                <PathButton
                  title="Build drop route"
                  sub="Tagged priority map"
                  onClick={() => applyPath('route')}
                />
              </div>
            </Panel>

            <Panel title="Listing Status">
              <div className="rr-toggle-row">
                {(['sold', 'pending', 'active', 'contingent'] as ListingStatus[]).map((status) => (
                  <button
                    key={status}
                    onClick={() => toggleStatus(status)}
                    className={`rr-status-toggle ${statuses.has(status) ? `on ${status}` : ''}`}
                  >
                    {status === 'sold' ? 'Just Sold' : status === 'active' ? 'For Sale' : status}
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title="Priority Score">
              <div className="rr-score-grid">
                {(['A', 'B', 'C', 'D'] as Score[]).map((score) => (
                  <button
                    key={score}
                    onClick={() => toggleScore(score)}
                    className={`rr-score-tile ${scores.has(score) ? `sel-${score}` : ''}`}
                  >
                    <span>{score}</span>
                    <small>{scoreLabel(score)}</small>
                  </button>
                ))}
              </div>
              <p className="rr-muted-copy">Scored from roof age, listing keywords, permit history, storm exposure &amp; AI signals</p>
            </Panel>

            <Panel title="Filters">
              <Range label="Minimum roof age" value={ageMin} min={0} max={40} suffix="yrs" onChange={setAgeMin} />
              <Range label="Activity within" value={daysMax} min={7} max={180} suffix="days" onChange={setDaysMax} />
            </Panel>

            <Panel title="Roof Distress Signals">
              <div className="rr-check-list">
                {[
                  ['Age 15+ yrs (asphalt shingles)', 'crit', true],
                  ['No roof permit on record', 'crit', true],
                  ['Storm exposure - hail/wind', 'crit', true],
                  ['Visible wear / curling', 'high', true],
                  ['Listing mentions "as-is"', 'high', true],
                  ['Prior insurance claim', 'high', false],
                  ['Moss / algae growth', 'med', false],
                  ['Estate / probate sale', 'med', false],
                ].map(([label, level, checked]) => (
                  <label key={String(label)} className="rr-check-row">
                    <input type="checkbox" defaultChecked={Boolean(checked)} />
                    <span>{label}</span>
                    <em className={String(level)}>{level}</em>
                  </label>
                ))}
              </div>
            </Panel>

            <Panel title="Export">
              <div className="rr-action-stack">
                <button
                  onClick={() => exportCsv(tagged, `arx_roofradar_tagged_${new Date().toISOString().slice(0, 10)}.csv`)}
                  className="rr-action primary"
                >
                  📋 Export Tagged to CSV
                </button>
                <button
                  onClick={() => exportCsv(filtered, `arx_roofradar_results_${new Date().toISOString().slice(0, 10)}.csv`)}
                  className="rr-action"
                >
                  ⬇ Export All Results
                </button>
                <button className="rr-action" onClick={() => setView('map')}>🖨 Print Route Sheet</button>
              </div>
            </Panel>

            <Panel title="Going Live?">
              <div className="rr-info-box">
                <strong>{dataMode === 'live' ? 'Live provider connected.' : 'Demo data is active.'}</strong>
                <p>{scanMessage}</p>
                <p>Free data is tied in for storm matching and geocoding. Listings still need a licensed provider or broker-approved MLS feed.</p>
              </div>
            </Panel>
          </div>
        </aside>

        <main className="rr-main">
          <div className="rr-toolbar">
            <div className="rr-result-info">
              Showing <strong>{filtered.length}</strong>
              <br />
              properties
            </div>
            <div className="rr-active-tags">
              <span>Age ≥{ageMin}yr</span>
              <span>Last {daysMax}d</span>
              <span>Score: {Array.from(scores).join('/')}</span>
              {stormHits > 0 && <span>{stormHits} Storm Hits</span>}
            </div>
            <div className="rr-view-btns">
              {(['grid', 'list', 'map'] as const).map((nextView) => (
                <button
                  key={nextView}
                  onClick={() => setView(nextView)}
                  className={view === nextView ? 'on' : ''}
                  title={nextView}
                >
                  {nextView === 'grid' ? '⊞' : nextView === 'list' ? '☰' : '◎'}
                </button>
              ))}
            </div>
          </div>

          {view === 'map' ? (
            <div className="rr-map-placeholder">
              <div>◎</div>
              <h2>Map View Coming Soon</h2>
              <p>
                Pin all tagged properties on an interactive route map. Integrate with Google Maps API to build
                optimized door-tag driving routes for each rep.
                </p>
              <button>Connect Google Maps</button>
            </div>
          ) : view === 'list' ? (
            <div className="rr-list-wrap">
              <table className="rr-list-table">
                <thead>
                  <tr>
                    <th>Score</th>
                    <th>Address</th>
                    <th>Status</th>
                    <th>Roof Age</th>
                    <th>Storm</th>
                    <th>Value</th>
                    <th>Signals</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((property) => (
                    <tr key={property.id}>
                      <td>
                        <ScoreBadge score={property.score} />
                      </td>
                      <td>
                        <button className="text-left" onClick={() => setActiveProperty(property)}>
                          <strong>{property.street}</strong>
                          <span>
                            {property.city} · {property.zip} · {property.source}
                          </span>
                        </button>
                      </td>
                      <td><StatusPill status={property.status} /></td>
                      <td className="age-hot">{property.roofAge}yr</td>
                      <td>
                        {stormSummary(property.storm)}
                      </td>
                      <td>{formatCurrency(property.value)}</td>
                      <td>{property.signals.slice(0, 2).join(', ')}</td>
                      <td>
                        <button onClick={() => toggleTagged(property.id)}>
                          {property.tagged ? 'Tagged' : 'Tag'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rr-card-grid">
              {filtered.map((property) => (
                <PropertyCard
                  key={property.id}
                  property={property}
                  onOpen={() => setActiveProperty(property)}
                  onTag={() => toggleTagged(property.id)}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {activeProperty && (
        <div className="rr-modal-mask" onClick={() => setActiveProperty(null)}>
          <div className="rr-modal" onClick={(event) => event.stopPropagation()}>
            <div className={`rr-card-band ${activeProperty.score}`} />
            <div className="flex items-start gap-4 p-5">
              <ScoreBadge score={activeProperty.score} />
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold">{activeProperty.street}</h2>
                <p className="text-sm text-[#8fa0bc]">
                  {activeProperty.city} · {activeProperty.zip} · {activeProperty.status.toUpperCase()} · {activeProperty.source}
                </p>
              </div>
              <button onClick={() => setActiveProperty(null)} className="text-[#8fa0bc]">Close</button>
            </div>
            <div className="grid gap-4 p-5 pt-0 md:grid-cols-2">
              <Detail label="Estimated roof age" value={`${activeProperty.roofAge} yrs`} />
              <Detail label="Last roofed approx." value={`${new Date().getFullYear() - activeProperty.roofAge}`} />
              <Detail label="Year built" value={`${activeProperty.yearBuilt}`} />
              <Detail label="Home value" value={formatCurrency(activeProperty.value)} />
              <Detail label="Hail history" value={`${activeProperty.storm.hailEvents} events · ${activeProperty.storm.maxHailInches}" max`} />
              <Detail label="Wind history" value={`${activeProperty.storm.windEvents} events · ${activeProperty.storm.maxWindMph} mph max`} />
            </div>
            <div className="px-5 pb-5">
              <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#C9A84C]">Storm Exposure</h3>
              <div className="mb-5 rounded border border-[#253870] bg-[#0B1628] p-4 text-sm text-[#8fa0bc]">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <strong className="block text-slate-100">{stormSummary(activeProperty.storm)}</strong>
                    <span>Nearby hail and damaging wind history</span>
                  </div>
                  <div>
                    <strong className="block text-slate-100">{activeProperty.storm.lastEventDaysAgo} days ago</strong>
                    <span>Most recent storm signal</span>
                  </div>
                  <div>
                    <strong className="block text-slate-100">{activeProperty.storm.confidence}</strong>
                    <span>Matching confidence</span>
                  </div>
                </div>
              </div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#C9A84C]">Signals</h3>
              <div className="flex flex-wrap gap-2">
                {activeProperty.signals.map((signal) => (
                  <span key={signal} className="rounded bg-[#0B1628] px-2 py-1 text-xs text-[#8fa0bc]">
                    {signal}
                  </span>
                ))}
              </div>
              <textarea
                value={activeProperty.notes}
                onChange={(event) => updateNotes(activeProperty.id, event.target.value)}
                placeholder="Field notes, access issues, owner context..."
                className="mt-4 h-24 w-full rounded border border-[#253870] bg-[#0B1628] p-3 text-sm outline-none focus:border-[#C9A84C]"
              />
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => toggleTagged(activeProperty.id)} className="rounded bg-[#C9A84C] px-4 py-2 text-xs font-black uppercase text-[#0B1628]">
                  {activeProperty.tagged ? 'Remove Tag' : 'Tag for Drop'}
                </button>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    `${activeProperty.street}, ${activeProperty.city}`
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-[#253870] px-4 py-2 text-xs font-bold uppercase text-[#8fa0bc]"
                >
                  Open in Maps
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
      <style jsx global>{`
        .rr-app {
          --navy: #0b1628;
          --navy2: #112040;
          --navy3: #142852;
          --ink: #061221;
          --gold: #c9a84c;
          --gold2: #e0bd52;
          --muted: #7890bb;
          --border: #1e3060;
          --border2: #294083;
          font-family: Barlow, 'Source Sans 3', system-ui, sans-serif;
          min-height: 100vh;
        }
        .rr-header {
          height: 76px;
          background: var(--navy);
          border-bottom: 1px solid var(--border2);
          display: grid;
          grid-template-columns: 290px 150px 1fr 160px;
          align-items: stretch;
          position: sticky;
          top: 0;
          z-index: 20;
        }
        .rr-brand {
          display: flex;
          align-items: center;
          gap: 18px;
          padding: 0 28px;
          border-right: 1px solid var(--border2);
        }
        .rr-brand-main {
          font-size: 30px;
          font-weight: 950;
          letter-spacing: 5px;
          color: #f4f7ff;
        }
        .rr-brand-sub {
          border-left: 1px solid var(--border2);
          color: var(--gold);
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 6px;
          padding-left: 18px;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .rr-live {
          align-self: center;
          border: 1px solid rgba(46, 204, 135, 0.3);
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          height: 46px;
          margin: 0 22px;
          color: #2ecc87;
          background: rgba(46, 204, 135, 0.1);
          font-size: 13px;
          font-weight: 900;
          letter-spacing: 2px;
          text-transform: uppercase;
        }
        .rr-live.is-demo {
          border-color: rgba(201, 168, 76, 0.35);
          background: rgba(201, 168, 76, 0.08);
          color: var(--gold);
        }
        .rr-live span {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: currentColor;
        }
        .rr-kpis {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          border-left: 1px solid var(--border2);
        }
        .rr-kpi {
          border-right: 1px solid var(--border2);
          display: flex;
          flex-direction: column;
          justify-content: center;
          text-align: center;
        }
        .rr-kpi-value {
          color: var(--gold);
          font-size: 30px;
          font-weight: 950;
          line-height: 1;
        }
        .rr-kpi-label {
          color: var(--muted);
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 2px;
          margin-top: 4px;
          text-transform: uppercase;
        }
        .rr-api-btn {
          align-self: center;
          background: #12244b;
          border: 1px solid var(--border2);
          border-radius: 6px;
          color: #9badcf;
          font-weight: 900;
          letter-spacing: 1px;
          margin: 0 22px;
          padding: 12px 18px;
          text-transform: uppercase;
        }
        .rr-api-btn span {
          margin-right: 10px;
        }
        .rr-body {
          display: grid;
          grid-template-columns: 380px minmax(0, 1fr);
          min-height: calc(100vh - 76px);
        }
        .rr-sidebar {
          background: var(--navy2);
          border-right: 1px solid var(--border2);
          height: calc(100vh - 76px);
          overflow-y: auto;
        }
        .rr-panel {
          border-bottom: 1px solid var(--border);
          padding: 20px;
        }
        .rr-panel-title {
          align-items: center;
          color: var(--gold);
          display: flex;
          gap: 14px;
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 5px;
          margin-bottom: 16px;
          text-transform: uppercase;
        }
        .rr-panel-title:after {
          content: '';
          background: var(--border);
          height: 1px;
          flex: 1;
        }
        .rr-search {
          display: grid;
          grid-template-columns: 1fr 110px;
          gap: 10px;
        }
        .rr-search-input,
        .rr-select {
          background: var(--ink);
          border: 1px solid var(--border2);
          border-radius: 6px;
          color: #eef4ff;
          font-size: 18px;
          outline: none;
          padding: 13px 16px;
        }
        .rr-scan-btn,
        .rr-action.primary,
        .rr-map-placeholder button {
          background: var(--gold);
          border-radius: 6px;
          color: #061221;
          font-weight: 950;
          letter-spacing: 1px;
          text-transform: uppercase;
        }
        .rr-scan-btn:disabled {
          opacity: 0.7;
        }
        .rr-muted-copy {
          color: var(--muted);
          font-size: 13px;
          line-height: 1.55;
          margin-top: 12px;
        }
        .rr-muted-copy strong,
        .rr-info-box strong {
          color: var(--gold);
        }
        .rr-source-row,
        .rr-toggle-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .rr-source-pill,
        .rr-status-toggle {
          border: 1px solid var(--border2);
          border-radius: 6px;
          color: var(--muted);
          font-size: 13px;
          font-weight: 900;
          padding: 9px 13px;
        }
        .rr-source-pill {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .rr-source-pill span {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: currentColor;
        }
        .rr-source-pill.on {
          border-color: var(--gold);
          color: var(--gold);
          background: rgba(201, 168, 76, 0.09);
        }
        .rr-status-toggle {
          border-radius: 999px;
          text-transform: capitalize;
        }
        .rr-status-toggle.on {
          background: var(--gold);
          color: #061221;
          border-color: var(--gold);
        }
        .rr-status-toggle.sold.on {
          background: rgba(46, 204, 135, 0.12);
          border-color: rgba(46, 204, 135, 0.4);
          color: #2ecc87;
        }
        .rr-path-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .rr-path-btn {
          background: var(--ink);
          border: 1px solid var(--border2);
          border-radius: 6px;
          padding: 10px;
          text-align: left;
        }
        .rr-path-btn strong {
          color: #e9f0ff;
          display: block;
          font-size: 13px;
          line-height: 1.15;
        }
        .rr-path-btn span {
          color: var(--muted);
          display: block;
          font-size: 11px;
          margin-top: 4px;
        }
        .rr-score-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
        }
        .rr-score-tile {
          background: #102149;
          border: 2px solid var(--border2);
          border-radius: 8px;
          color: var(--muted);
          padding: 14px 4px 12px;
          text-align: center;
        }
        .rr-score-tile span {
          display: block;
          font-size: 26px;
          font-weight: 950;
          line-height: 1;
        }
        .rr-score-tile small {
          display: block;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 1px;
          margin-top: 7px;
          text-transform: uppercase;
        }
        .rr-score-tile.sel-A { border-color: #ff4b4b; background: rgba(255, 75, 75, 0.13); color: #ff4b4b; }
        .rr-score-tile.sel-B { border-color: #ff864d; background: rgba(255, 134, 77, 0.13); color: #ff864d; }
        .rr-score-tile.sel-C { border-color: #ffd34d; background: rgba(255, 211, 77, 0.1); color: #ffd34d; }
        .rr-score-tile.sel-D { border-color: #2ecc87; background: rgba(46, 204, 135, 0.1); color: #2ecc87; }
        .rr-range-row {
          align-items: center;
          display: grid;
          grid-template-columns: 115px 1fr 55px;
          gap: 12px;
          margin-bottom: 14px;
        }
        .rr-range-row label {
          color: #e7eefb;
          font-weight: 700;
        }
        .rr-range-row input {
          accent-color: var(--gold);
        }
        .rr-range-row strong {
          color: var(--gold);
          font-weight: 900;
          text-align: right;
        }
        .rr-check-list {
          display: grid;
          gap: 10px;
        }
        .rr-check-row {
          align-items: center;
          display: grid;
          grid-template-columns: 28px 1fr 52px;
          gap: 8px;
          color: #e8effb;
          font-weight: 700;
        }
        .rr-check-row input {
          accent-color: var(--gold);
          width: 18px;
          height: 18px;
        }
        .rr-check-row em {
          border-radius: 5px;
          font-size: 11px;
          font-style: normal;
          font-weight: 950;
          padding: 4px 6px;
          text-align: center;
          text-transform: uppercase;
        }
        .rr-check-row em.crit { color: #ff4b4b; background: rgba(255, 75, 75, 0.15); }
        .rr-check-row em.high { color: #ff864d; background: rgba(255, 134, 77, 0.15); }
        .rr-check-row em.med { color: #ffd34d; background: rgba(255, 211, 77, 0.13); }
        .rr-action-stack {
          display: grid;
          gap: 10px;
        }
        .rr-action {
          border: 1px solid var(--border2);
          border-radius: 6px;
          color: #9badcf;
          font-weight: 950;
          letter-spacing: 0.5px;
          padding: 14px 12px;
          text-transform: uppercase;
        }
        .rr-info-box {
          border: 1px solid rgba(201, 168, 76, 0.25);
          border-radius: 8px;
          color: #9badcf;
          font-size: 13px;
          line-height: 1.6;
          padding: 16px;
          background: rgba(201, 168, 76, 0.06);
        }
        .rr-main {
          min-width: 0;
          background: var(--ink);
        }
        .rr-toolbar {
          min-height: 88px;
          align-items: center;
          background: var(--navy2);
          border-bottom: 1px solid var(--border);
          display: grid;
          grid-template-columns: 135px 1fr auto;
          gap: 18px;
          padding: 14px 28px;
        }
        .rr-result-info {
          color: var(--muted);
          font-size: 20px;
          font-weight: 700;
          line-height: 1.25;
        }
        .rr-result-info strong {
          color: var(--gold);
          font-size: 26px;
        }
        .rr-active-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .rr-active-tags span {
          border: 1px solid rgba(201, 168, 76, 0.35);
          border-radius: 999px;
          color: var(--gold);
          font-size: 13px;
          font-weight: 900;
          padding: 7px 14px;
        }
        .rr-view-btns {
          display: flex;
          gap: 8px;
        }
        .rr-view-btns button {
          width: 44px;
          height: 44px;
          border: 1px solid var(--border2);
          border-radius: 6px;
          color: var(--muted);
          font-size: 22px;
        }
        .rr-view-btns button.on {
          background: var(--gold);
          color: #061221;
          border-color: var(--gold);
        }
        .rr-map-placeholder {
          min-height: calc(100vh - 164px);
          display: grid;
          place-items: center;
          align-content: center;
          text-align: center;
          color: var(--muted);
          padding: 40px;
        }
        .rr-map-placeholder div {
          font-size: 58px;
          opacity: 0.35;
        }
        .rr-map-placeholder h2 {
          color: #9badcf;
          font-size: 28px;
          font-weight: 950;
          margin-top: 24px;
        }
        .rr-map-placeholder p {
          max-width: 680px;
          font-size: 18px;
          line-height: 1.7;
          margin: 22px auto 36px;
        }
        .rr-map-placeholder button {
          padding: 18px 42px;
        }
        .rr-card-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(430px, 1fr));
          gap: 20px;
          padding: 28px;
        }
        .rr-card {
          background: var(--navy2);
          border: 1px solid var(--border2);
          border-radius: 10px;
          overflow: hidden;
        }
        .rr-card-band {
          height: 4px;
        }
        .rr-card-band.A { background: #ff4b4b; }
        .rr-card-band.B { background: #ff864d; }
        .rr-card-band.C { background: #ffd34d; }
        .rr-card-band.D { background: #2ecc87; }
        .rr-card-head {
          display: grid;
          grid-template-columns: 56px 1fr auto;
          gap: 16px;
          align-items: center;
          padding: 22px;
        }
        .rr-card-title {
          color: #f2f6ff;
          display: block;
          font-size: 20px;
          font-weight: 950;
        }
        .rr-card-sub {
          color: var(--muted);
          display: block;
          font-size: 15px;
          margin-top: 3px;
        }
        .rr-card-metrics {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          border-top: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
        }
        .rr-metric {
          padding: 16px 8px;
          text-align: center;
          border-right: 1px solid var(--border);
        }
        .rr-metric:last-child {
          border-right: 0;
        }
        .rr-metric-value {
          color: #eff5ff;
          font-size: 19px;
          font-weight: 950;
        }
        .rr-metric-value.hot {
          color: #ff4b4b;
        }
        .rr-metric-label {
          color: var(--muted);
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 1.5px;
          margin-top: 4px;
          text-transform: uppercase;
        }
        .rr-card-foot {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 16px;
          align-items: center;
          padding: 18px 22px;
        }
        .rr-signals {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          min-height: 30px;
        }
        .rr-signal {
          border: 1px solid rgba(255, 75, 75, 0.35);
          border-radius: 5px;
          color: #ff7474;
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 0.7px;
          padding: 6px 10px;
          text-transform: uppercase;
          background: rgba(255, 75, 75, 0.12);
        }
        .rr-card-actions {
          display: flex;
          gap: 8px;
        }
        .rr-card-actions button {
          width: 42px;
          height: 42px;
          border: 1px solid var(--border2);
          border-radius: 7px;
          color: var(--gold);
          font-weight: 950;
        }
        .rr-list-wrap {
          padding: 28px;
          overflow-x: auto;
        }
        .rr-list-table {
          border-collapse: collapse;
          min-width: 980px;
          width: 100%;
        }
        .rr-list-table thead {
          background: var(--navy2);
          color: var(--muted);
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 2px;
          text-transform: uppercase;
        }
        .rr-list-table th,
        .rr-list-table td {
          padding: 18px;
          border-bottom: 1px solid #07152a;
        }
        .rr-list-table tbody tr {
          background: var(--navy2);
        }
        .rr-list-table td strong {
          color: #f3f6ff;
          display: block;
          font-size: 18px;
          font-weight: 950;
        }
        .rr-list-table td span {
          color: var(--muted);
        }
        .rr-list-table .age-hot {
          color: #ff4b4b;
          font-size: 18px;
          font-weight: 950;
        }
        .rr-status-pill {
          border: 1px solid rgba(201, 168, 76, 0.45);
          border-radius: 5px;
          color: var(--gold);
          display: inline-block;
          font-size: 11px;
          font-weight: 950;
          letter-spacing: 2px;
          min-width: 72px;
          padding: 7px 10px;
          text-align: center;
          text-transform: uppercase;
        }
        .rr-status-pill.sold {
          border-color: rgba(46, 204, 135, 0.4);
          color: #2ecc87;
          background: rgba(46, 204, 135, 0.08);
        }
        .rr-score-badge {
          width: 48px;
          height: 48px;
          border: 1px solid currentColor;
          border-radius: 8px;
          display: grid;
          place-items: center;
          font-size: 24px;
          font-weight: 950;
        }
        .rr-score-badge.A { color: #ff4b4b; background: rgba(255, 75, 75, 0.13); }
        .rr-score-badge.B { color: #ff864d; background: rgba(255, 134, 77, 0.13); }
        .rr-score-badge.C { color: #ffd34d; background: rgba(255, 211, 77, 0.1); }
        .rr-score-badge.D { color: #2ecc87; background: rgba(46, 204, 135, 0.1); }
        .rr-modal-mask {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.66);
          z-index: 50;
          display: grid;
          place-items: center;
          padding: 20px;
        }
        .rr-modal {
          width: min(720px, 100%);
          max-height: 90vh;
          overflow: auto;
          background: var(--navy2);
          border: 1px solid var(--border2);
          border-radius: 10px;
        }
        @media (max-width: 980px) {
          .rr-header {
            grid-template-columns: 1fr;
            height: auto;
            position: static;
          }
          .rr-brand,
          .rr-live,
          .rr-api-btn {
            margin: 10px 20px;
          }
          .rr-kpis {
            grid-template-columns: repeat(2, 1fr);
          }
          .rr-body {
            grid-template-columns: 1fr;
          }
          .rr-sidebar {
            height: auto;
          }
          .rr-toolbar {
            grid-template-columns: 1fr;
          }
          .rr-card-grid {
            grid-template-columns: 1fr;
            padding: 14px;
          }
        }
      `}</style>
    </div>
  )
}

const DEFAULT_SOURCES: SourceStatus[] = [
  {
    key: 'listings',
    label: 'Listing Feed',
    provider: 'not configured',
    configured: false,
    cadence: 'provider-dependent',
    note: 'Connect ListHub, PropAPIS, RealtyAPI, MLS Grid, Bridge, or Spark through the server adapter.',
  },
  {
    key: 'public-records',
    label: 'Public Records',
    provider: 'county assessor/open-data endpoint',
    configured: false,
    cadence: 'daily/weekly by county source',
    note: 'Free county assessor, parcel, and tax portals are market-by-market.',
  },
  {
    key: 'permits',
    label: 'Roof Permits',
    provider: 'county permit/open-data endpoint',
    configured: false,
    cadence: 'county/provider-dependent',
    note: 'Use Socrata or ArcGIS open-data APIs when the target county publishes permits.',
  },
  {
    key: 'storm',
    label: 'Storm History',
    provider: 'NOAA/SPC public storm reports',
    configured: true,
    cadence: 'daily plus post-event refresh',
    note: 'Hail and damaging wind events enrich property priority.',
  },
  {
    key: 'geocoder',
    label: 'Geocoder',
    provider: 'US Census Geocoder',
    configured: true,
    cadence: 'on demand',
    note: 'Free address-to-coordinate fallback for storm matching.',
  },
]

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rr-kpi">
      <div className="rr-kpi-value">{value}</div>
      <div className="rr-kpi-label">{label}</div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rr-panel">
      <h2 className="rr-panel-title">{title}</h2>
      {children}
    </section>
  )
}

function PathButton({ title, sub, onClick }: { title: string; sub: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rr-path-btn"
    >
      <strong>{title}</strong>
      <span>{sub}</span>
    </button>
  )
}

function Range(props: {
  label: string
  value: number
  min: number
  max: number
  suffix: string
  onChange: (value: number) => void
}) {
  return (
    <div className="rr-range-row">
      <label>{props.label}</label>
      <input
        type="range"
        value={props.value}
        min={props.min}
        max={props.max}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
      <strong>
        {props.value}
        {props.suffix === 'yrs' ? '' : ` ${props.suffix}`}
      </strong>
    </div>
  )
}

function PropertyCard(props: { property: RadarProperty; onOpen: () => void; onTag: () => void }) {
  const { property } = props
  return (
    <article className="rr-card">
      <div className={`rr-card-band ${property.score}`} />
      <div>
        <div className="rr-card-head">
          <ScoreBadge score={property.score} />
          <button onClick={props.onOpen} className="text-left min-w-0">
            <span className="rr-card-title">{property.street}</span>
            <span className="rr-card-sub">
              {property.city} · {property.zip} · {property.source}
            </span>
          </button>
          <StatusPill status={property.status} />
        </div>
        <div className="rr-card-metrics">
          <Metric label="Roof Age" value={`${property.roofAge}yr`} hot={property.roofAge >= 15} />
          <Metric label="Storm" value={stormShort(property.storm)} hot={property.storm.hailEvents > 0 || property.storm.maxWindMph >= 58} />
          <Metric label="Value" value={formatCurrency(property.value)} />
          <Metric label="Activity" value={`${property.daysAgo}d`} />
        </div>
        <div className="rr-card-foot">
          <div className="rr-signals">
            {property.signals.slice(0, 3).map((signal) => (
              <span key={signal} className="rr-signal">
                {signal}
              </span>
            ))}
          </div>
          <div className="rr-card-actions">
            <button onClick={props.onTag} title="Tag for drop">
              {property.tagged ? '✓' : '📌'}
            </button>
            <button onClick={props.onOpen} title="Open detail">→</button>
          </div>
        </div>
      </div>
    </article>
  )
}

function Metric({ label, value, hot = false }: { label: string; value: string; hot?: boolean }) {
  return (
    <div className="rr-metric">
      <div className={`rr-metric-value ${hot ? 'hot' : ''}`}>{value}</div>
      <div className="rr-metric-label">{label}</div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[#1e3060] bg-[#0B1628] p-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#5a7099]">{label}</div>
      <div className="mt-1 text-lg font-black text-[#C9A84C]">{value}</div>
    </div>
  )
}

function ScoreBadge({ score }: { score: Score }) {
  return <div className={`rr-score-badge ${score}`}>{score}</div>
}

function StatusPill({ status }: { status: ListingStatus }) {
  return <span className={`rr-status-pill ${status}`}>{status}</span>
}

function formatCurrency(value: number) {
  return value >= 1000000 ? `$${(value / 1000000).toFixed(2)}M` : `$${Math.round(value / 1000)}K`
}

function stormShort(storm: StormExposure) {
  if (storm.hailEvents > 0) return `${storm.maxHailInches}" hail`
  if (storm.maxWindMph >= 58) return `${storm.maxWindMph}mph`
  return storm.confidence
}

function stormSummary(storm: StormExposure) {
  const parts = []
  if (storm.hailEvents > 0) parts.push(`${storm.hailEvents} hail`)
  if (storm.windEvents > 0) parts.push(`${storm.windEvents} wind`)
  if (!parts.length) return 'No major hit'
  return `${parts.join(' · ')} · ${storm.confidence}`
}

function scoreClass(score: Score) {
  switch (score) {
    case 'A':
      return 'border-red-400 bg-red-500/15 text-red-300'
    case 'B':
      return 'border-orange-400 bg-orange-500/15 text-orange-300'
    case 'C':
      return 'border-yellow-400 bg-yellow-500/15 text-yellow-300'
    case 'D':
      return 'border-emerald-400 bg-emerald-500/15 text-emerald-300'
  }
}

function scoreBand(score: Score) {
  switch (score) {
    case 'A':
      return 'bg-red-400'
    case 'B':
      return 'bg-orange-400'
    case 'C':
      return 'bg-yellow-400'
    case 'D':
      return 'bg-emerald-400'
  }
}

function scoreLabel(score: Score) {
  switch (score) {
    case 'A':
      return 'Critical'
    case 'B':
      return 'High'
    case 'C':
      return 'Medium'
    case 'D':
      return 'Low'
  }
}
