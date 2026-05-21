'use client'

import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RoofRadarProperty, RoofRadarScore, RoofRadarStormExposure, RoofRadarStormEvent } from '@/lib/roofradar'

type Score = RoofRadarScore
type ListingStatus = 'sold' | 'pending' | 'active' | 'contingent'
type RadarProperty = RoofRadarProperty
type StormExposure = RoofRadarStormExposure
type Toast = { id: number; message: string; type: 'success' | 'info' | 'error' }

type SourceStatus = {
  key: string
  label: string
  provider: string
  configured: boolean
  cadence: string
  note: string
}

type ZipStat = {
  zip: string
  total: number
  aCount: number
  abCount: number
  avgAge: number
  avgValue: number
  stormCount: number
  density: number
  badge: string
}

// ---- CONSTANTS ----

const SCAN_STEPS = [
  'Connecting to data sources...',
  'Pulling Redfin listings...',
  'Pulling Zillow listings...',
  'Cross-referencing roof permits...',
  'Estimating roof ages...',
  'Scoring distress signals...',
  'Ranking results...',
]

const ZIP_CITIES: Record<string, string> = {
  '28081': 'Kannapolis',
  '28082': 'Kannapolis',
  '28025': 'Concord',
  '28027': 'Concord',
  '28036': 'Harrisburg',
  '28107': 'Midland',
  '28124': 'Mt Pleasant',
  '28088': 'Landis',
}

// Approximate bounding-box polygons [lat, lng] for Cabarrus County ZIPs
const ZIP_POLYGONS: Record<string, [number, number][]> = {
  '28081': [[35.455, -80.685], [35.455, -80.600], [35.530, -80.600], [35.530, -80.685]],
  '28082': [[35.480, -80.660], [35.480, -80.575], [35.555, -80.575], [35.555, -80.660]],
  '28025': [[35.365, -80.575], [35.365, -80.485], [35.435, -80.485], [35.435, -80.575]],
  '28027': [[35.355, -80.705], [35.355, -80.575], [35.440, -80.575], [35.440, -80.705]],
  '28036': [[35.285, -80.735], [35.285, -80.615], [35.360, -80.615], [35.360, -80.735]],
  '28107': [[35.350, -80.555], [35.350, -80.435], [35.425, -80.435], [35.425, -80.555]],
  '28124': [[35.360, -80.495], [35.360, -80.385], [35.445, -80.385], [35.445, -80.495]],
  '28088': [[35.530, -80.615], [35.530, -80.545], [35.610, -80.545], [35.610, -80.615]],
}

const SCORE_COLOR: Record<Score, string> = {
  A: '#e63535',
  B: '#f07040',
  C: '#f5c030',
  D: '#28d98a',
}

// ---- DEMO DATA ----

const STREETS = [
  'Maple Creek Dr', 'Blue Ridge Pkwy', 'Cabarrus Ave E', 'Old Concord Rd',
  'Harris Rd', 'Poplar Tent Rd', 'Rocky River Rd', 'Lake Concord Rd',
  'Kannapolis Pkwy', 'George W Liles Pkwy', 'Copperfield Blvd', 'Flowes Store Rd',
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
  'Age 20+ yrs', 'No roof permit found', 'Storm exposure', 'Visible shingle wear',
  'Listing says as-is', 'Estate sale', 'Prior claim signal', 'Moss or algae growth',
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

  // Build a realistic demo event list with actual dates
  const totalEvents = hailEvents + windEvents
  const recentEvents: StormExposure['recentEvents'] = []
  if (totalEvents > 0) {
    // Spread events across the last 3 years
    let offsetDays = lastEventDaysAgo
    for (let i = 0; i < Math.min(totalEvents, 8); i++) {
      const isHail = i < hailEvents
      const eventDate = new Date(Date.now() - offsetDays * 86400000)
      recentEvents.push({
        type: isHail ? 'hail' : 'wind',
        date: eventDate.toISOString().slice(0, 10),
        magnitude: isHail
          ? Number((rnd(6, maxHailTenths || 10, seed + i + 50) / 10).toFixed(1))
          : rnd(35, maxWindMph || 55, seed + i + 51),
        distanceMiles: Number((rnd(1, 79, seed + i + 52) / 10).toFixed(1)),
      })
      offsetDays += rnd(45, 280, seed + i + 60) // space events apart
    }
  }

  const lastEventDate =
    lastEventDaysAgo < 1300
      ? new Date(Date.now() - lastEventDaysAgo * 86400000).toISOString().slice(0, 10)
      : undefined

  return {
    hailEvents,
    maxHailInches: Number((maxHailTenths / 10).toFixed(1)),
    windEvents,
    maxWindMph,
    lastEventDaysAgo,
    ...(lastEventDate ? { lastEventDate } : {}),
    confidence,
    ...(recentEvents.length > 0 ? { recentEvents } : {}),
  }
}

const makeDataset = (search: string): RadarProperty[] => {
  const base = search.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return Array.from({ length: 126 }, (_, index) => {
    const seed = base + index + 1
    const market = CITIES[rnd(0, CITIES.length - 1, seed)]
    const street = `${rnd(100, 9999, seed + 2)} ${STREETS[rnd(0, STREETS.length - 1, seed + 3)]}`
    const roofAge = rnd(0, 42, seed + 4)
    const storm = makeStormExposure(seed)
    const signalCount = roofAge >= 22 ? rnd(4, 7, seed + 5) : roofAge >= 15 ? rnd(2, 5, seed + 5) : rnd(0, 2, seed + 5)
    const signals = [...SIGNALS]
      .sort((a, b) => (rnd(0, 100, seed + a.length) > rnd(0, 100, seed + b.length) ? 1 : -1))
      .slice(0, signalCount)
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
      status: (['sold', 'sold', 'pending', 'pending', 'active', 'contingent'] as ListingStatus[])[rnd(0, 5, seed + 6)],
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

// ---- MAIN COMPONENT ----

export default function RoofRadarClient() {
  const [search, setSearch] = useState('28081')
  const [properties, setProperties] = useState<RadarProperty[]>(() => makeDataset('28081'))
  const [dataMode, setDataMode] = useState<'demo' | 'live'>('demo')
  const [scanMessage, setScanMessage] = useState('Demo data loaded. Configure a listing provider to scan live feeds.')
  const [isScanning, setIsScanning] = useState(false)
  const [scanStep, setScanStep] = useState(-1)
  const [sources, setSources] = useState<SourceStatus[]>([])
  const [statuses, setStatuses] = useState<Set<ListingStatus>>(new Set<ListingStatus>(['sold', 'pending']))
  const [scores, setScores] = useState<Set<Score>>(new Set<Score>(['A', 'B', 'C']))
  const [ageMin, setAgeMin] = useState(12)
  const [daysMax, setDaysMax] = useState(90)
  const [view, setView] = useState<'grid' | 'list' | 'map'>('grid')
  const [activeProperty, setActiveProperty] = useState<RadarProperty | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [selectedZip, setSelectedZip] = useState<string | null>(null)
  const [showHeatLayer, setShowHeatLayer] = useState(true)
  const [showPins, setShowPins] = useState(true)
  const [mapTaggedOnly, setMapTaggedOnly] = useState(false)
  const [stormLookup, setStormLookup] = useState<{
    loading: boolean
    events: RoofRadarStormEvent[]
    summary: {
      totalEvents: number
      hailEvents: number
      maxHailInches: number
      windEvents: number
      maxWindMph: number
      lastEventDate: string | null
      lastEventDaysAgo: number | null
      confidence: string
    } | null
    error: string | null
    addressId: string | null
  }>({ loading: false, events: [], summary: null, error: null, addressId: null })

  // Filtered without ZIP drill-down (used for ZIP panel stats + KPIs)
  const filteredAll = useMemo(
    () =>
      properties
        .filter((p) => statuses.has(p.status))
        .filter((p) => scores.has(p.score))
        .filter((p) => p.roofAge >= ageMin)
        .filter((p) => p.daysAgo <= daysMax)
        .sort((a, b) => scoreRank.indexOf(a.score) - scoreRank.indexOf(b.score) || b.roofAge - a.roofAge),
    [ageMin, daysMax, properties, scores, statuses]
  )

  // Filtered with ZIP drill-down (used for center view)
  const filtered = useMemo(
    () => filteredAll.filter((p) => !selectedZip || p.zip === selectedZip),
    [filteredAll, selectedZip]
  )

  const tagged = properties.filter((p) => p.tagged)
  const priorityA = filteredAll.filter((p) => p.score === 'A').length
  const zipCount = new Set(filteredAll.map((p) => p.zip)).size
  const stormHits = filteredAll.filter((p) => p.storm.hailEvents > 0 || p.storm.maxWindMph >= 58).length

  const zipStats = useMemo<ZipStat[]>(() => {
    const byZip: Record<string, RadarProperty[]> = {}
    filteredAll.forEach((p) => {
      if (!byZip[p.zip]) byZip[p.zip] = []
      byZip[p.zip].push(p)
    })
    return Object.entries(byZip)
      .map(([zip, props]) => {
        const aCount = props.filter((p) => p.score === 'A').length
        const abCount = props.filter((p) => p.score === 'A' || p.score === 'B').length
        const avgAge = Math.round(props.reduce((s, p) => s + p.roofAge, 0) / props.length)
        const avgValue = Math.round(props.reduce((s, p) => s + p.value, 0) / props.length)
        const stormCount = props.filter((p) => p.storm.hailEvents > 0 || p.storm.maxWindMph >= 58).length
        const density = abCount / props.length
        const badge = density >= 0.6 ? 'HOT' : density >= 0.4 ? 'WARM' : density >= 0.2 ? 'MED' : 'COOL'
        return { zip, total: props.length, aCount, abCount, avgAge, avgValue, stormCount, density, badge }
      })
      .sort((a, b) => b.density - a.density)
  }, [filteredAll])

  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000)
  }, [])

  useEffect(() => {
    let alive = true
    fetch('/api/admin/roofradar/sources', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (!alive) return
        if (payload && Array.isArray(payload.sources)) setSources(payload.sources)
      })
      .catch(() => { if (alive) setSources([]) })
    return () => { alive = false }
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
    setSelectedZip(null)
    if (path === 'storm') {
      setStatuses(new Set<ListingStatus>(['sold', 'pending', 'active']))
      setScores(new Set<Score>(['A', 'B']))
      setAgeMin(10); setDaysMax(120); setView('grid')
    }
    if (path === 'pending') {
      setStatuses(new Set<ListingStatus>(['pending', 'contingent']))
      setScores(new Set<Score>(['A', 'B', 'C']))
      setAgeMin(8); setDaysMax(90); setView('list')
    }
    if (path === 'aged') {
      setStatuses(new Set<ListingStatus>(['sold', 'pending', 'active']))
      setScores(new Set<Score>(['A', 'B', 'C']))
      setAgeMin(18); setDaysMax(180); setView('grid')
    }
    if (path === 'route') {
      setStatuses(new Set<ListingStatus>(['sold', 'pending']))
      setScores(new Set<Score>(['A', 'B']))
      setAgeMin(12); setDaysMax(90); setView('map')
    }
  }

  const handleToggleTagged = (id: RadarProperty['id']) => {
    const prop = properties.find((p) => p.id === id)
    if (prop) addToast(prop.tagged ? `Removed: ${prop.street}` : `Tagged: ${prop.street}`, 'success')
    setProperties((current) => current.map((p) => (p.id === id ? { ...p, tagged: !p.tagged } : p)))
    setActiveProperty((current) => (current && current.id === id ? { ...current, tagged: !current.tagged } : current))
  }

  const updateNotes = (id: RadarProperty['id'], notes: string) => {
    setProperties((current) => current.map((p) => (p.id === id ? { ...p, notes } : p)))
    setActiveProperty((current) => (current && current.id === id ? { ...current, notes } : current))
  }

  const fetchFullStormHistory = useCallback(async (property: RadarProperty) => {
    const addressId = String(property.id)
    setStormLookup({ loading: true, events: [], summary: null, error: null, addressId })
    try {
      const body = (property.lat != null && property.lng != null)
        ? { lat: property.lat, lng: property.lng, radiusMiles: 8 }
        : { address: `${property.street}, ${property.city}, NC ${property.zip}`, radiusMiles: 8 }
      const res = await fetch('/api/admin/roofradar/storm-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) {
        setStormLookup({ loading: false, events: [], summary: null, error: data?.error || 'Lookup failed', addressId })
      } else {
        setStormLookup({ loading: false, events: data.events || [], summary: data.summary || null, error: null, addressId })
      }
    } catch {
      setStormLookup({ loading: false, events: [], summary: null, error: 'Network error', addressId })
    }
  }, [])

  const scan = async () => {
    const query = search.trim() || '28081'
    setIsScanning(true)
    setScanStep(0)
    setSelectedZip(null)

    let step = 0
    const interval = setInterval(() => {
      step++
      if (step < SCAN_STEPS.length) setScanStep(step)
    }, 330)

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
        // Parcel data (county ArcGIS) tags everything as 'active' — open that filter so rows are visible
        if (payload.dataType === 'parcels') {
          setStatuses(new Set<ListingStatus>(['active', 'pending', 'sold']))
          setScores(new Set<Score>(['A', 'B', 'C', 'D']))
        }
        const geocoder = payload.openData?.geocoder
        const storm = payload.openData?.storm
        const freeNote =
          geocoder || storm
            ? ` Free data: ${storm?.provider || 'storm adapter'} matched within ${storm?.radiusMiles || 8}mi; ${geocoder?.matched || 0}/${geocoder?.attempted || 0} Census geocodes matched.`
            : ''
        const parcelNote = payload.dataType === 'parcels'
          ? ' (county parcel records — all homeowners, not just active listings)'
          : ''
        setScanMessage(`Loaded ${payload.properties.length} live records from ${payload.provider || 'provider'}.${parcelNote}${freeNote}`)
        addToast(`Scan complete — ${payload.properties.length} live properties loaded`, 'success')
      } else {
        setProperties(makeDataset(query))
        setDataMode('demo')
        setScanMessage(payload?.details || payload?.error || 'Live provider unavailable. Showing demo records.')
        addToast(`Demo data loaded for ${query}`, 'info')
      }
    } catch {
      setProperties(makeDataset(query))
      setDataMode('demo')
      setScanMessage('Live provider request failed. Showing demo records.')
      addToast(`Demo data loaded for ${query}`, 'info')
    } finally {
      clearInterval(interval)
      setScanStep(SCAN_STEPS.length)
      await new Promise((resolve) => setTimeout(resolve, 500))
      setScanStep(-1)
      setIsScanning(false)
      setActiveProperty(null)
    }
  }

  const exportCsv = (rows: RadarProperty[], filename: string) => {
    const headers = [
      'Address', 'City', 'ZIP', 'Status', 'Score', 'Roof Age', 'Year Built',
      'Value', 'Sq Ft', 'Source', 'Hail Events', 'Max Hail Inches', 'Wind Events',
      'Max Wind MPH', 'Last Storm Days Ago', 'Storm Confidence', 'Signals', 'Notes',
    ]
    const csvRows = rows.map((p) => [
      p.street, p.city, p.zip, p.status, p.score, p.roofAge, p.yearBuilt,
      p.value, p.sqft, p.source, p.storm.hailEvents, p.storm.maxHailInches,
      p.storm.windEvents, p.storm.maxWindMph, p.storm.lastEventDaysAgo,
      p.storm.confidence, p.signals.join(' | '), p.notes.replaceAll(',', ';'),
    ])
    const csv = [headers, ...csvRows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = filename; anchor.click()
    URL.revokeObjectURL(url)
    addToast(`Exported ${rows.length} properties`, 'success')
  }

  const buildRoute = () => {
    if (!tagged.length) { addToast('Tag some properties first to build a route', 'info'); return }
    // Google Maps Directions supports up to 23 waypoints (origin + 21 stops + destination)
    const stops = tagged.slice(0, 23)
    const encoded = stops.map((p) => encodeURIComponent(`${p.street}, ${p.city}, NC`))
    const url = `https://www.google.com/maps/dir/${encoded.join('/')}`
    window.open(url, '_blank')
    addToast(`Opened ${stops.length}-stop route in Google Maps${tagged.length > 23 ? ` (first 23 of ${tagged.length})` : ''}`, 'success')
  }

  const printRouteSheet = () => {
    if (tagged.length === 0) { addToast('Tag some properties first to generate a route sheet', 'info'); return }
    const win = window.open('', '_blank')
    if (!win) return
    const rows = tagged.map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${p.street}</strong><br><span>${p.city}, ${p.zip}</span></td>
        <td class="sc-${p.score}">${p.score}</td>
        <td>${p.status.toUpperCase()}</td>
        <td>${p.roofAge} yrs</td>
        <td>$${Math.round(p.value / 1000)}K</td>
        <td>${p.signals.slice(0, 3).join(', ')}</td>
        <td>${p.notes}</td>
      </tr>`).join('')
    win.document.write(`<!DOCTYPE html><html><head><title>ARX Roofing — Door Tag Route Sheet</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 28px; }
h1 { font-size: 20px; font-weight: 900; letter-spacing: 1px; margin-bottom: 4px; }
.meta { color: #666; font-size: 13px; margin-bottom: 22px; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { background: #0B1628; color: #fff; padding: 9px 8px; text-align: left; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; }
td { padding: 8px; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
tr:nth-child(even) td { background: #f9f9f9; }
td strong { display: block; font-size: 13px; }
td span { color: #666; font-size: 11px; }
.sc-A { font-weight: 900; color: #c00; }
.sc-B { font-weight: 900; color: #e07000; }
.sc-C { font-weight: 900; color: #888000; }
.sc-D { font-weight: 900; color: #080; }
@media print { body { padding: 12px; } }
</style></head><body>
<h1>ARX ROOFING — DOOR TAG ROUTE SHEET</h1>
<p class="meta">Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} &nbsp;·&nbsp; ${tagged.length} tagged properties</p>
<table><thead><tr><th>#</th><th>Address</th><th>Score</th><th>Status</th><th>Roof Age</th><th>Value</th><th>Key Signals</th><th>Notes</th></tr></thead>
<tbody>${rows}</tbody></table>
<script>setTimeout(()=>window.print(),300)</script></body></html>`)
    win.document.close()
    addToast(`Route sheet opened — ${tagged.length} properties`, 'success')
  }

  return (
    <div className="rr-app min-h-screen bg-[#061221] text-slate-100">
      <header className="rr-header">
        <div className="rr-brand">
          <div className="rr-brand-main">ARX</div>
          <div className="rr-brand-sub">RoofRadar™</div>
        </div>
        <div className={`rr-live ${dataMode === 'live' ? 'is-live' : 'is-demo'}`}>
          <span />{dataMode === 'live' ? 'Live Data' : 'Demo Data'}
        </div>
        <div className="rr-kpis">
          <Kpi label="Properties" value={filteredAll.length} />
          <Kpi label="Priority A" value={priorityA} />
          <Kpi label="Tagged" value={tagged.length} />
          <Kpi label="ZIP Codes" value={zipCount} />
        </div>
        <button
          type="button"
          className="rr-api-btn"
          onClick={() => addToast('Provider settings are managed by server env vars.', 'info')}
        >
          <span>⊙</span> API Settings
        </button>
      </header>

      {/* Scan overlay */}
      {scanStep >= 0 && <ScanOverlay step={scanStep} />}

      {/* Toast stack */}
      <ToastStack toasts={toasts} />

      <div className="rr-body">
        {/* ---- LEFT SIDEBAR ---- */}
        <aside className="rr-sidebar">
          <Panel title="Search Area">
            <div className="rr-search">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && scan()}
                className="rr-search-input"
                placeholder="ZIP, city, or county"
              />
              <button onClick={scan} disabled={isScanning} className="rr-scan-btn">
                {isScanning ? 'Scanning' : '▶ Scan'}
              </button>
            </div>
            <p className="rr-muted-copy">
              Listings require an approved feed · free storm history via <strong>NOAA/SPC</strong> · geocoding via <strong>US Census</strong>
            </p>
          </Panel>

          <Panel title="Data Sources">
            <div className="rr-source-row">
              {(sources.length ? sources : DEFAULT_SOURCES).slice(0, 5).map((s) => (
                <div key={s.key} className={`rr-source-pill ${s.configured ? 'on' : ''}`} title={s.note}>
                  <span />{s.label.replace('Listing Feed', 'Listings').replace('Storm History', 'Storms')}
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Rep Paths">
            <div className="rr-path-grid">
              <PathButton title="Storm-hit movers" sub="Hail/wind + active market" onClick={() => applyPath('storm')} />
              <PathButton title="Pending closings" sub="Buyer/seller timing" onClick={() => applyPath('pending')} />
              <PathButton title="Old roof targets" sub="Aged roof + activity" onClick={() => applyPath('aged')} />
              <PathButton title="Build drop route" sub="Tagged priority map" onClick={() => applyPath('route')} />
            </div>
          </Panel>

          <Panel title="Listing Status">
            <div className="rr-toggle-row">
              {(['sold', 'pending', 'active', 'contingent'] as ListingStatus[]).map((s) => (
                <button key={s} onClick={() => toggleStatus(s)} className={`rr-status-toggle ${statuses.has(s) ? `on ${s}` : ''}`}>
                  {s === 'sold' ? 'Just Sold' : s === 'active' ? 'For Sale' : s}
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Priority Score">
            <div className="rr-score-grid">
              {(['A', 'B', 'C', 'D'] as Score[]).map((sc) => (
                <button key={sc} onClick={() => toggleScore(sc)} className={`rr-score-tile ${scores.has(sc) ? `sel-${sc}` : ''}`}>
                  <span>{sc}</span><small>{scoreLabel(sc)}</small>
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
              {([
                ['Age 15+ yrs (asphalt shingles)', 'crit', true],
                ['No roof permit on record', 'crit', true],
                ['Storm exposure - hail/wind', 'crit', true],
                ['Visible wear / curling', 'high', true],
                ['Listing mentions "as-is"', 'high', true],
                ['Prior insurance claim', 'high', false],
                ['Moss / algae growth', 'med', false],
                ['Estate / probate sale', 'med', false],
              ] as [string, string, boolean][]).map(([label, level, checked]) => (
                <label key={label} className="rr-check-row">
                  <input type="checkbox" defaultChecked={checked} />
                  <span>{label}</span>
                  <em className={level}>{level}</em>
                </label>
              ))}
            </div>
          </Panel>

          <Panel title="Export">
            <div className="rr-action-stack">
              <button onClick={printRouteSheet} className="rr-action primary">🖨 Print Route Sheet</button>
              <button onClick={() => exportCsv(tagged, `arx_tagged_${new Date().toISOString().slice(0, 10)}.csv`)} className="rr-action">
                📋 Export Tagged to CSV
              </button>
              <button onClick={() => exportCsv(filteredAll, `arx_results_${new Date().toISOString().slice(0, 10)}.csv`)} className="rr-action">
                ⬇ Export All Results
              </button>
            </div>
          </Panel>

          <Panel title="Going Live?">
            <div className="rr-info-box">
              <strong>{dataMode === 'live' ? 'Live provider connected.' : 'Demo data is active.'}</strong>
              <p>{scanMessage}</p>
              <p>Free data for storm matching and geocoding is wired in. Listings need a licensed provider or broker-approved MLS feed.</p>
            </div>
          </Panel>
        </aside>

        {/* ---- CENTER MAIN ---- */}
        <main className="rr-main">
          <div className="rr-toolbar">
            <div className="rr-result-info">
              Showing <strong>{filtered.length}</strong><br />properties
            </div>
            <div className="rr-active-tags">
              <span>Age ≥{ageMin}yr</span>
              <span>Last {daysMax}d</span>
              <span>Score: {Array.from(scores).join('/')}</span>
              {stormHits > 0 && <span>{stormHits} Storm Hits</span>}
              {selectedZip && (
                <button className="rr-zip-filter-tag" onClick={() => setSelectedZip(null)}>
                  ZIP {selectedZip} ✕
                </button>
              )}
            </div>
            <div className="rr-view-btns">
              {(['grid', 'list', 'map'] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} className={view === v ? 'on' : ''} title={v}>
                  {v === 'grid' ? '⊞' : v === 'list' ? '☰' : '◎'}
                </button>
              ))}
            </div>
          </div>

          {view === 'map' ? (
            <MapView
              filtered={filtered}
              selectedZip={selectedZip}
              setSelectedZip={setSelectedZip}
              showHeatLayer={showHeatLayer}
              setShowHeatLayer={setShowHeatLayer}
              showPins={showPins}
              setShowPins={setShowPins}
              mapTaggedOnly={mapTaggedOnly}
              setMapTaggedOnly={setMapTaggedOnly}
              onTag={handleToggleTagged}
              onOpen={setActiveProperty}
              zipStats={zipStats}
              onBuildRoute={buildRoute}
            />
          ) : view === 'list' ? (
            <div className="rr-list-wrap">
              <table className="rr-list-table">
                <thead>
                  <tr>
                    <th>Score</th><th>Address</th><th>Status</th>
                    <th>Roof Age</th><th>Storm</th><th>Value</th>
                    <th>Signals</th><th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} className={p.tagged ? 'row-tagged' : ''}>
                      <td><ScoreBadge score={p.score} /></td>
                      <td>
                        <button className="text-left" onClick={() => setActiveProperty(p)}>
                          <strong>{p.street}</strong>
                          <span>{p.city} · {p.zip} · {p.source}</span>
                        </button>
                      </td>
                      <td><StatusPill status={p.status} /></td>
                      <td className="age-hot">{p.roofAge}yr</td>
                      <td>{stormSummary(p.storm)}</td>
                      <td>{formatCurrency(p.value)}</td>
                      <td>{p.signals.slice(0, 2).join(', ')}</td>
                      <td>
                        <button
                          className={`rr-tag-btn ${p.tagged ? 'tagged' : ''}`}
                          onClick={() => handleToggleTagged(p.id)}
                        >
                          {p.tagged ? '✓' : '📌'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rr-card-grid">
              {filtered.map((p) => (
                <PropertyCard
                  key={p.id}
                  property={p}
                  onOpen={() => setActiveProperty(p)}
                  onTag={() => handleToggleTagged(p.id)}
                />
              ))}
            </div>
          )}
        </main>

        {/* ---- RIGHT ZIP PANEL ---- */}
        <aside className="rr-zip-panel">
          <ZipPanel
            zipStats={zipStats}
            selectedZip={selectedZip}
            setSelectedZip={setSelectedZip}
            onDrill={(zip) => { setSelectedZip(zip); setView('grid') }}
          />
        </aside>
      </div>

      {/* ---- PROPERTY MODAL ---- */}
      {activeProperty && (
        <div className="rr-modal-mask" onClick={() => { setActiveProperty(null); setStormLookup({ loading: false, events: [], summary: null, error: null, addressId: null }) }}>
          <div className="rr-modal" onClick={(e) => e.stopPropagation()}>
            <div className={`rr-card-band ${activeProperty.score}`} />
            <div className="flex items-start gap-4 p-5">
              <ScoreBadge score={activeProperty.score} />
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold">{activeProperty.street}</h2>
                <p className="text-sm text-[#8fa0bc]">
                  {activeProperty.city} · {activeProperty.zip} · {activeProperty.status.toUpperCase()} · {activeProperty.source}
                </p>
              </div>
              <button onClick={() => { setActiveProperty(null); setStormLookup({ loading: false, events: [], summary: null, error: null, addressId: null }) }} className="text-[#8fa0bc]">Close</button>
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

              {/* Summary bar */}
              <div className="mb-3 rounded border border-[#253870] bg-[#0B1628] p-4 text-sm text-[#8fa0bc]">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <strong className="block text-slate-100">{stormSummary(activeProperty.storm)}</strong>
                    <span>Nearby hail &amp; wind history</span>
                  </div>
                  <div>
                    <strong className="block text-slate-100">
                      {activeProperty.storm.lastEventDate
                        ? new Date(activeProperty.storm.lastEventDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : activeProperty.storm.lastEventDaysAgo < 1300
                          ? `${activeProperty.storm.lastEventDaysAgo}d ago`
                          : 'No recent events'}
                    </strong>
                    <span>Most recent storm signal</span>
                  </div>
                  <div>
                    <strong className="block text-slate-100">{activeProperty.storm.confidence}</strong>
                    <span>Matching confidence</span>
                  </div>
                </div>
              </div>

              {/* Recent event timeline */}
              {(activeProperty.storm.recentEvents && activeProperty.storm.recentEvents.length > 0) && (
                <div className="rr-storm-timeline mb-3">
                  {activeProperty.storm.recentEvents.map((ev, i) => (
                    <div key={i} className={`rr-storm-row ${ev.type}`}>
                      <span className="rr-storm-icon">{ev.type === 'hail' ? '🧊' : '💨'}</span>
                      <span className="rr-storm-date">
                        {new Date(ev.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      <span className="rr-storm-type">{ev.type === 'hail' ? 'Hail' : 'Wind'}</span>
                      <span className="rr-storm-mag">
                        {ev.type === 'hail' ? `${ev.magnitude}"` : `${ev.magnitude} mph`}
                      </span>
                      <span className="rr-storm-dist">{ev.distanceMiles} mi away</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Full storm history lookup */}
              {stormLookup.addressId === String(activeProperty.id) && stormLookup.loading && (
                <div className="rr-storm-loading mb-3">⏳ Fetching full storm history from NOAA/SPC…</div>
              )}
              {stormLookup.addressId === String(activeProperty.id) && stormLookup.error && (
                <div className="rr-storm-error mb-3">⚠️ {stormLookup.error}</div>
              )}
              {stormLookup.addressId === String(activeProperty.id) && stormLookup.summary && !stormLookup.loading && (
                <div className="mb-3">
                  <div className="rr-storm-lookup-header">
                    Full history · {stormLookup.summary.totalEvents} events in 8 mi radius (NOAA/SPC, 5 yrs)
                  </div>
                  <div className="rr-storm-timeline">
                    {stormLookup.events.length === 0 && (
                      <div className="rr-storm-empty">No storm events found near this address.</div>
                    )}
                    {stormLookup.events.map((ev, i) => (
                      <div key={i} className={`rr-storm-row ${ev.type}`}>
                        <span className="rr-storm-icon">{ev.type === 'hail' ? '🧊' : '💨'}</span>
                        <span className="rr-storm-date">
                          {new Date(ev.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                        <span className="rr-storm-type">{ev.type === 'hail' ? 'Hail' : 'Wind'}</span>
                        <span className="rr-storm-mag">
                          {ev.type === 'hail' ? `${ev.magnitude}"` : `${ev.magnitude} mph`}
                        </span>
                        <span className="rr-storm-dist">{ev.distanceMiles} mi away</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(stormLookup.addressId !== String(activeProperty.id) || (!stormLookup.loading && !stormLookup.summary && !stormLookup.error)) && (
                <button
                  className="rr-storm-full-btn mb-5"
                  onClick={() => fetchFullStormHistory(activeProperty)}
                >
                  Full Storm History →
                </button>
              )}
              <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[#C9A84C]">Signals</h3>
              <div className="flex flex-wrap gap-2">
                {activeProperty.signals.map((sig) => (
                  <span key={sig} className="rounded bg-[#0B1628] px-2 py-1 text-xs text-[#8fa0bc]">{sig}</span>
                ))}
              </div>
              <textarea
                value={activeProperty.notes}
                onChange={(e) => updateNotes(activeProperty.id, e.target.value)}
                placeholder="Field notes, access issues, owner context..."
                className="mt-4 h-24 w-full rounded border border-[#253870] bg-[#0B1628] p-3 text-sm outline-none focus:border-[#C9A84C]"
              />
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => handleToggleTagged(activeProperty.id)}
                  className="rounded bg-[#C9A84C] px-4 py-2 text-xs font-black uppercase text-[#0B1628]"
                >
                  {activeProperty.tagged ? 'Remove Tag' : '📌 Tag for Drop'}
                </button>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${activeProperty.street}, ${activeProperty.city}`)}`}
                  target="_blank" rel="noreferrer"
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
          --navy: #0b1628; --navy2: #112040; --navy3: #142852;
          --ink: #061221; --gold: #c9a84c; --gold2: #e0bd52;
          --muted: #7890bb; --border: #1e3060; --border2: #294083;
          font-family: Barlow, 'Source Sans 3', system-ui, sans-serif;
          min-height: 100vh;
        }
        .rr-header {
          height: 76px; background: var(--navy);
          border-bottom: 1px solid var(--border2);
          display: grid; grid-template-columns: 290px 150px 1fr 160px;
          align-items: stretch; position: sticky; top: 0; z-index: 20;
        }
        .rr-brand { display: flex; align-items: center; gap: 18px; padding: 0 28px; border-right: 1px solid var(--border2); }
        .rr-brand-main { font-size: 30px; font-weight: 950; letter-spacing: 5px; color: #f4f7ff; }
        .rr-brand-sub { border-left: 1px solid var(--border2); color: var(--gold); font-size: 12px; font-weight: 900; letter-spacing: 6px; padding-left: 18px; text-transform: uppercase; white-space: nowrap; }
        .rr-live { align-self: center; border: 1px solid rgba(46,204,135,0.3); border-radius: 999px; display: flex; align-items: center; justify-content: center; gap: 10px; height: 46px; margin: 0 22px; color: #2ecc87; background: rgba(46,204,135,0.1); font-size: 13px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; }
        .rr-live.is-demo { border-color: rgba(201,168,76,0.35); background: rgba(201,168,76,0.08); color: var(--gold); }
        .rr-live span { width: 9px; height: 9px; border-radius: 50%; background: currentColor; }
        .rr-kpis { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); border-left: 1px solid var(--border2); }
        .rr-kpi { border-right: 1px solid var(--border2); display: flex; flex-direction: column; justify-content: center; text-align: center; }
        .rr-kpi-value { color: var(--gold); font-size: 30px; font-weight: 950; line-height: 1; }
        .rr-kpi-label { color: var(--muted); font-size: 11px; font-weight: 900; letter-spacing: 2px; margin-top: 4px; text-transform: uppercase; }
        .rr-api-btn { align-self: center; background: #12244b; border: 1px solid var(--border2); border-radius: 6px; color: #9badcf; font-weight: 900; letter-spacing: 1px; margin: 0 22px; padding: 12px 18px; text-transform: uppercase; }
        .rr-api-btn span { margin-right: 10px; }
        .rr-body { display: grid; grid-template-columns: 380px minmax(0,1fr) 320px; min-height: calc(100vh - 76px); }
        .rr-sidebar { background: var(--navy2); border-right: 1px solid var(--border2); height: calc(100vh - 76px); overflow-y: auto; }
        .rr-panel { border-bottom: 1px solid var(--border); padding: 20px; }
        .rr-panel-title { align-items: center; color: var(--gold); display: flex; gap: 14px; font-size: 11px; font-weight: 950; letter-spacing: 5px; margin-bottom: 16px; text-transform: uppercase; }
        .rr-panel-title:after { content: ''; background: var(--border); height: 1px; flex: 1; }
        .rr-search { display: grid; grid-template-columns: 1fr 110px; gap: 10px; }
        .rr-search-input, .rr-select { background: var(--ink); border: 1px solid var(--border2); border-radius: 6px; color: #eef4ff; font-size: 18px; outline: none; padding: 13px 16px; }
        .rr-scan-btn, .rr-action.primary { background: var(--gold); border-radius: 6px; color: #061221; font-weight: 950; letter-spacing: 1px; text-transform: uppercase; }
        .rr-scan-btn:disabled { opacity: 0.7; }
        .rr-muted-copy { color: var(--muted); font-size: 13px; line-height: 1.55; margin-top: 12px; }
        .rr-muted-copy strong, .rr-info-box strong { color: var(--gold); }
        .rr-source-row, .rr-toggle-row { display: flex; flex-wrap: wrap; gap: 8px; }
        .rr-source-pill, .rr-status-toggle { border: 1px solid var(--border2); border-radius: 6px; color: var(--muted); font-size: 13px; font-weight: 900; padding: 9px 13px; }
        .rr-source-pill { display: flex; align-items: center; gap: 8px; }
        .rr-source-pill span { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
        .rr-source-pill.on { border-color: var(--gold); color: var(--gold); background: rgba(201,168,76,0.09); }
        .rr-status-toggle { border-radius: 999px; text-transform: capitalize; }
        .rr-status-toggle.on { background: var(--gold); color: #061221; border-color: var(--gold); }
        .rr-status-toggle.sold.on { background: rgba(46,204,135,0.12); border-color: rgba(46,204,135,0.4); color: #2ecc87; }
        .rr-path-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .rr-path-btn { background: var(--ink); border: 1px solid var(--border2); border-radius: 6px; padding: 10px; text-align: left; }
        .rr-path-btn strong { color: #e9f0ff; display: block; font-size: 13px; line-height: 1.15; }
        .rr-path-btn span { color: var(--muted); display: block; font-size: 11px; margin-top: 4px; }
        .rr-score-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 8px; }
        .rr-score-tile { background: #102149; border: 2px solid var(--border2); border-radius: 8px; color: var(--muted); padding: 14px 4px 12px; text-align: center; }
        .rr-score-tile span { display: block; font-size: 26px; font-weight: 950; line-height: 1; }
        .rr-score-tile small { display: block; font-size: 10px; font-weight: 900; letter-spacing: 1px; margin-top: 7px; text-transform: uppercase; }
        .rr-score-tile.sel-A { border-color: #ff4b4b; background: rgba(255,75,75,0.13); color: #ff4b4b; }
        .rr-score-tile.sel-B { border-color: #ff864d; background: rgba(255,134,77,0.13); color: #ff864d; }
        .rr-score-tile.sel-C { border-color: #ffd34d; background: rgba(255,211,77,0.1); color: #ffd34d; }
        .rr-score-tile.sel-D { border-color: #2ecc87; background: rgba(46,204,135,0.1); color: #2ecc87; }
        .rr-range-row { align-items: center; display: grid; grid-template-columns: 115px 1fr 55px; gap: 12px; margin-bottom: 14px; }
        .rr-range-row label { color: #e7eefb; font-weight: 700; }
        .rr-range-row input { accent-color: var(--gold); }
        .rr-range-row strong { color: var(--gold); font-weight: 900; text-align: right; }
        .rr-check-list { display: grid; gap: 10px; }
        .rr-check-row { align-items: center; display: grid; grid-template-columns: 28px 1fr 52px; gap: 8px; color: #e8effb; font-weight: 700; }
        .rr-check-row input { accent-color: var(--gold); width: 18px; height: 18px; }
        .rr-check-row em { border-radius: 5px; font-size: 11px; font-style: normal; font-weight: 950; padding: 4px 6px; text-align: center; text-transform: uppercase; }
        .rr-check-row em.crit { color: #ff4b4b; background: rgba(255,75,75,0.15); }
        .rr-check-row em.high { color: #ff864d; background: rgba(255,134,77,0.15); }
        .rr-check-row em.med { color: #ffd34d; background: rgba(255,211,77,0.13); }
        .rr-action-stack { display: grid; gap: 10px; }
        .rr-action { border: 1px solid var(--border2); border-radius: 6px; color: #9badcf; font-weight: 950; letter-spacing: 0.5px; padding: 14px 12px; text-transform: uppercase; }
        .rr-info-box { border: 1px solid rgba(201,168,76,0.25); border-radius: 8px; color: #9badcf; font-size: 13px; line-height: 1.6; padding: 16px; background: rgba(201,168,76,0.06); }
        .rr-main { min-width: 0; background: var(--ink); }
        .rr-toolbar { min-height: 88px; align-items: center; background: var(--navy2); border-bottom: 1px solid var(--border); display: grid; grid-template-columns: 135px 1fr auto; gap: 18px; padding: 14px 28px; }
        .rr-result-info { color: var(--muted); font-size: 20px; font-weight: 700; line-height: 1.25; }
        .rr-result-info strong { color: var(--gold); font-size: 26px; }
        .rr-active-tags { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .rr-active-tags span { border: 1px solid rgba(201,168,76,0.35); border-radius: 999px; color: var(--gold); font-size: 13px; font-weight: 900; padding: 7px 14px; }
        .rr-zip-filter-tag { border: 1px solid rgba(46,204,135,0.5); border-radius: 999px; color: #2ecc87; font-size: 13px; font-weight: 900; padding: 7px 14px; background: rgba(46,204,135,0.08); cursor: pointer; }
        .rr-view-btns { display: flex; gap: 8px; }
        .rr-view-btns button { width: 44px; height: 44px; border: 1px solid var(--border2); border-radius: 6px; color: var(--muted); font-size: 22px; }
        .rr-view-btns button.on { background: var(--gold); color: #061221; border-color: var(--gold); }
        .rr-card-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(380px,1fr)); gap: 20px; padding: 28px; }
        .rr-card { background: var(--navy2); border: 1px solid var(--border2); border-radius: 10px; overflow: hidden; transition: border-color 0.2s, box-shadow 0.2s; }
        .rr-card.tagged { border-color: rgba(46,204,135,0.55); box-shadow: 0 0 0 2px rgba(46,204,135,0.18), 0 4px 20px rgba(46,204,135,0.1); }
        .rr-card-band { height: 4px; }
        .rr-card-band.A { background: #ff4b4b; }
        .rr-card-band.B { background: #ff864d; }
        .rr-card-band.C { background: #ffd34d; }
        .rr-card-band.D { background: #2ecc87; }
        .rr-card-head { display: grid; grid-template-columns: 56px 1fr auto; gap: 16px; align-items: center; padding: 22px; }
        .rr-card-title { color: #f2f6ff; display: block; font-size: 20px; font-weight: 950; }
        .rr-card-sub { color: var(--muted); display: block; font-size: 15px; margin-top: 3px; }
        .rr-card-metrics { display: grid; grid-template-columns: repeat(4,1fr); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .rr-metric { padding: 16px 8px; text-align: center; border-right: 1px solid var(--border); }
        .rr-metric:last-child { border-right: 0; }
        .rr-metric-value { color: #eff5ff; font-size: 19px; font-weight: 950; }
        .rr-metric-value.hot { color: #ff4b4b; }
        .rr-metric-label { color: var(--muted); font-size: 10px; font-weight: 900; letter-spacing: 1.5px; margin-top: 4px; text-transform: uppercase; }
        .rr-card-foot { display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center; padding: 18px 22px; }
        .rr-signals { display: flex; flex-wrap: wrap; gap: 8px; min-height: 30px; }
        .rr-signal { border: 1px solid rgba(255,75,75,0.35); border-radius: 5px; color: #ff7474; font-size: 11px; font-weight: 950; letter-spacing: 0.7px; padding: 6px 10px; text-transform: uppercase; background: rgba(255,75,75,0.12); }
        .rr-card-actions { display: flex; gap: 8px; }
        .rr-card-actions button { width: 42px; height: 42px; border: 1px solid var(--border2); border-radius: 7px; color: var(--gold); font-weight: 950; }
        .rr-list-wrap { padding: 28px; overflow-x: auto; }
        .rr-list-table { border-collapse: collapse; min-width: 980px; width: 100%; }
        .rr-list-table thead { background: var(--navy2); color: var(--muted); font-size: 11px; font-weight: 950; letter-spacing: 2px; text-transform: uppercase; }
        .rr-list-table th, .rr-list-table td { padding: 18px; border-bottom: 1px solid #07152a; }
        .rr-list-table tbody tr { background: var(--navy2); }
        .rr-list-table tbody tr.row-tagged { background: rgba(46,204,135,0.06); border-left: 3px solid rgba(46,204,135,0.5); }
        .rr-list-table td strong { color: #f3f6ff; display: block; font-size: 18px; font-weight: 950; }
        .rr-list-table td span { color: var(--muted); }
        .rr-list-table .age-hot { color: #ff4b4b; font-size: 18px; font-weight: 950; }
        .rr-tag-btn { width: 38px; height: 38px; border: 1px solid var(--border2); border-radius: 6px; color: var(--gold); font-weight: 950; }
        .rr-tag-btn.tagged { background: rgba(46,204,135,0.12); border-color: rgba(46,204,135,0.4); color: #2ecc87; }
        .rr-status-pill { border: 1px solid rgba(201,168,76,0.45); border-radius: 5px; color: var(--gold); display: inline-block; font-size: 11px; font-weight: 950; letter-spacing: 2px; min-width: 72px; padding: 7px 10px; text-align: center; text-transform: uppercase; }
        .rr-status-pill.sold { border-color: rgba(46,204,135,0.4); color: #2ecc87; background: rgba(46,204,135,0.08); }
        .rr-score-badge { width: 48px; height: 48px; border: 1px solid currentColor; border-radius: 8px; display: grid; place-items: center; font-size: 24px; font-weight: 950; flex-shrink: 0; }
        .rr-score-badge.A { color: #ff4b4b; background: rgba(255,75,75,0.13); }
        .rr-score-badge.B { color: #ff864d; background: rgba(255,134,77,0.13); }
        .rr-score-badge.C { color: #ffd34d; background: rgba(255,211,77,0.1); }
        .rr-score-badge.D { color: #2ecc87; background: rgba(46,204,135,0.1); }
        .rr-modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.66); z-index: 50; display: grid; place-items: center; padding: 20px; }
        .rr-modal { width: min(720px,100%); max-height: 90vh; overflow: auto; background: var(--navy2); border: 1px solid var(--border2); border-radius: 10px; }

        /* ---- MAP ---- */
        .rr-map-wrap { position: relative; height: calc(100vh - 164px); }
        .rr-map-container { height: 100%; width: 100%; }
        .rr-map-controls { position: absolute; top: 14px; right: 14px; z-index: 1000; display: flex; gap: 8px; }
        .rr-map-controls button { background: rgba(11,22,40,0.9); border: 1px solid var(--border2); border-radius: 6px; color: var(--muted); font-size: 12px; font-weight: 900; letter-spacing: 1px; padding: 8px 12px; text-transform: uppercase; backdrop-filter: blur(4px); }
        .rr-map-controls button.on { background: rgba(201,168,76,0.15); border-color: var(--gold); color: var(--gold); }
        .rr-route-btn { background: rgba(201,168,76,0.18) !important; border-color: var(--gold) !important; color: var(--gold) !important; font-weight: 950 !important; }
        .rr-map-legend { position: absolute; bottom: 28px; left: 14px; z-index: 1000; background: rgba(11,22,40,0.92); border: 1px solid var(--border2); border-radius: 8px; padding: 12px 16px; backdrop-filter: blur(4px); }
        .rr-legend-title { color: var(--gold); font-size: 10px; font-weight: 950; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 8px; }
        .rr-legend-item { display: flex; align-items: center; gap: 8px; color: #9badcf; font-size: 12px; font-weight: 700; margin-bottom: 5px; }
        .rr-legend-item span { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
        .rr-map-loading { height: calc(100vh - 164px); display: grid; place-items: center; color: var(--muted); font-size: 16px; }

        /* ---- SCAN OVERLAY ---- */
        .rr-scan-mask { position: fixed; inset: 0; background: rgba(6,18,33,0.88); z-index: 60; display: grid; place-items: center; backdrop-filter: blur(6px); }
        .rr-scan-modal { background: var(--navy2); border: 1px solid var(--border2); border-radius: 12px; padding: 36px 44px; min-width: 380px; }
        .rr-scan-header { display: flex; align-items: center; gap: 14px; margin-bottom: 28px; }
        .rr-scan-header span { color: #f0f6ff; font-size: 20px; font-weight: 950; letter-spacing: 2px; text-transform: uppercase; }
        .rr-scan-spinner { width: 22px; height: 22px; border: 3px solid var(--border2); border-top-color: var(--gold); border-radius: 50%; animation: rr-spin 0.7s linear infinite; flex-shrink: 0; }
        @keyframes rr-spin { to { transform: rotate(360deg); } }
        .rr-scan-step { display: flex; align-items: center; gap: 14px; padding: 9px 0; color: var(--muted); font-size: 15px; font-weight: 700; border-bottom: 1px solid var(--border); transition: color 0.2s; }
        .rr-scan-step:last-child { border-bottom: 0; }
        .rr-scan-step.active { color: var(--gold); }
        .rr-scan-step.done { color: #2ecc87; }
        .rr-scan-step-icon { font-size: 16px; width: 22px; text-align: center; flex-shrink: 0; }

        /* ---- TOASTS ---- */
        .rr-toast-stack { position: fixed; bottom: 24px; right: 24px; z-index: 70; display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
        .rr-toast { background: var(--navy2); border: 1px solid var(--border2); border-radius: 8px; color: #dce8ff; font-size: 14px; font-weight: 700; padding: 14px 20px; max-width: 340px; animation: rr-slide-up 0.25s ease; pointer-events: auto; }
        .rr-toast.success { border-color: rgba(46,204,135,0.4); background: rgba(46,204,135,0.08); color: #a0f0cc; }
        .rr-toast.error { border-color: rgba(255,75,75,0.4); background: rgba(255,75,75,0.08); color: #ffaaaa; }
        @keyframes rr-slide-up { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }

        /* ---- ZIP PANEL ---- */
        .rr-zip-panel { background: var(--navy2); border-left: 1px solid var(--border2); height: calc(100vh - 76px); overflow-y: auto; display: flex; flex-direction: column; }
        .rr-zip-panel-header-wrap { display: flex; flex-direction: column; flex: 1; }
        .rr-zip-panel-header { background: var(--navy3); border-bottom: 1px solid var(--border2); display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; position: sticky; top: 0; z-index: 5; }
        .rr-zip-panel-header h2 { color: var(--gold); font-size: 11px; font-weight: 950; letter-spacing: 5px; text-transform: uppercase; }
        .rr-zip-panel-header span { color: var(--muted); font-size: 12px; font-weight: 700; }
        .rr-zip-list { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
        .rr-zip-card { background: var(--ink); border: 1px solid var(--border2); border-radius: 8px; cursor: pointer; overflow: hidden; transition: border-color 0.15s; }
        .rr-zip-card:hover { border-color: var(--border2); filter: brightness(1.05); }
        .rr-zip-card.selected { border-left: 3px solid var(--gold); border-color: rgba(201,168,76,0.4); }
        .rr-zip-card-top { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; }
        .rr-zip-number { color: #f0f6ff; font-size: 22px; font-weight: 950; letter-spacing: 1px; }
        .rr-zip-city { color: var(--muted); font-size: 12px; font-weight: 700; flex: 1; }
        .rr-zip-badge { border-radius: 5px; font-size: 10px; font-weight: 950; letter-spacing: 2px; padding: 4px 8px; text-transform: uppercase; }
        .rr-zip-badge.hot { background: rgba(255,75,75,0.18); color: #ff6060; border: 1px solid rgba(255,75,75,0.3); }
        .rr-zip-badge.warm { background: rgba(255,134,77,0.18); color: #ff9060; border: 1px solid rgba(255,134,77,0.3); }
        .rr-zip-badge.med { background: rgba(255,211,77,0.12); color: #ffd34d; border: 1px solid rgba(255,211,77,0.3); }
        .rr-zip-badge.cool { background: rgba(46,204,135,0.1); color: #2ecc87; border: 1px solid rgba(46,204,135,0.25); }
        .rr-zip-bars { padding: 4px 16px 10px; display: flex; flex-direction: column; gap: 6px; }
        .rr-zip-bar-row { display: grid; grid-template-columns: 64px 1fr 28px; align-items: center; gap: 8px; }
        .rr-zip-bar-row span { color: var(--muted); font-size: 10px; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase; }
        .rr-zip-bar-track { height: 5px; background: var(--border); border-radius: 99px; overflow: hidden; }
        .rr-zip-bar-fill { height: 100%; background: rgba(201,168,76,0.7); border-radius: 99px; transition: width 0.4s ease; }
        .rr-zip-bar-fill.red { background: rgba(255,75,75,0.75); }
        .rr-zip-bar-fill.orange { background: rgba(255,134,77,0.75); }
        .rr-zip-bar-row strong { color: var(--gold); font-size: 11px; font-weight: 950; text-align: right; }
        .rr-zip-stats { display: grid; grid-template-columns: repeat(3,1fr); border-top: 1px solid var(--border); }
        .rr-zip-stats > div { padding: 10px 12px; text-align: center; border-right: 1px solid var(--border); }
        .rr-zip-stats > div:last-child { border-right: 0; }
        .rr-zip-stats small { color: var(--muted); display: block; font-size: 9px; font-weight: 900; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 3px; }
        .rr-zip-stats span { color: #f0f6ff; font-size: 16px; font-weight: 950; }
        .rr-zip-drill-btn { border-top: 1px solid var(--border); color: var(--gold); display: block; font-size: 12px; font-weight: 950; letter-spacing: 1px; padding: 10px 16px; text-transform: uppercase; text-align: left; width: 100%; }
        .rr-zip-drill-btn:hover { background: rgba(201,168,76,0.06); }

        /* ---- STORM TIMELINE ---- */
        .rr-storm-timeline { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; font-size: 13px; }
        .rr-storm-row { display: grid; grid-template-columns: 26px 120px 48px 80px 1fr; align-items: center; gap: 10px; padding: 9px 14px; border-bottom: 1px solid var(--border); color: #9badcf; transition: background 0.15s; }
        .rr-storm-row:last-child { border-bottom: 0; }
        .rr-storm-row:hover { background: rgba(255,255,255,0.03); }
        .rr-storm-row.hail { border-left: 3px solid rgba(100,180,255,0.5); }
        .rr-storm-row.wind { border-left: 3px solid rgba(255,200,80,0.5); }
        .rr-storm-icon { font-size: 15px; text-align: center; }
        .rr-storm-date { color: #e4ecff; font-weight: 700; white-space: nowrap; }
        .rr-storm-type { color: var(--muted); font-size: 11px; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; }
        .rr-storm-mag { color: #f0f6ff; font-weight: 950; font-size: 14px; }
        .rr-storm-dist { color: var(--muted); font-size: 12px; text-align: right; }
        .rr-storm-full-btn { border: 1px solid rgba(201,168,76,0.4); border-radius: 6px; color: var(--gold); font-size: 12px; font-weight: 950; letter-spacing: 1px; padding: 9px 16px; text-transform: uppercase; background: rgba(201,168,76,0.07); transition: background 0.15s; }
        .rr-storm-full-btn:hover { background: rgba(201,168,76,0.14); }
        .rr-storm-lookup-header { background: rgba(201,168,76,0.07); border: 1px solid rgba(201,168,76,0.25); border-radius: 6px 6px 0 0; color: var(--gold); font-size: 11px; font-weight: 950; letter-spacing: 1.5px; padding: 8px 14px; text-transform: uppercase; margin-bottom: -1px; }
        .rr-storm-loading { color: var(--muted); font-size: 13px; font-weight: 700; padding: 10px 0; }
        .rr-storm-error { color: #ff7474; font-size: 13px; font-weight: 700; padding: 10px 0; }
        .rr-storm-empty { color: var(--muted); font-size: 13px; padding: 14px; text-align: center; }

        /* ---- RESPONSIVE ---- */
        @media (max-width: 1200px) {
          .rr-body { grid-template-columns: 340px minmax(0,1fr) 280px; }
        }
        @media (max-width: 980px) {
          .rr-header { grid-template-columns: 1fr; height: auto; position: static; }
          .rr-brand, .rr-live, .rr-api-btn { margin: 10px 20px; }
          .rr-kpis { grid-template-columns: repeat(2,1fr); }
          .rr-body { grid-template-columns: 1fr; }
          .rr-sidebar, .rr-zip-panel { height: auto; }
          .rr-toolbar { grid-template-columns: 1fr; }
          .rr-card-grid { grid-template-columns: 1fr; padding: 14px; }
          .rr-zip-panel { order: -1; }
        }
      `}</style>
    </div>
  )
}

// ---- MAP COMPONENT (Google Maps JS API) ----

type MapViewProps = {
  filtered: RadarProperty[]
  selectedZip: string | null
  setSelectedZip: (zip: string | null) => void
  showHeatLayer: boolean
  setShowHeatLayer: (v: boolean) => void
  showPins: boolean
  setShowPins: (v: boolean) => void
  mapTaggedOnly: boolean
  setMapTaggedOnly: (v: boolean) => void
  onTag: (id: RadarProperty['id']) => void
  onOpen: (p: RadarProperty) => void
  zipStats: ZipStat[]
  onBuildRoute: () => void
}

function MapView({
  filtered, selectedZip, setSelectedZip,
  showHeatLayer, setShowHeatLayer,
  showPins, setShowPins,
  mapTaggedOnly, setMapTaggedOnly,
  onTag, onOpen, onBuildRoute,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const polygonsRef = useRef<Record<string, any>>({})
  const infoWindowRef = useRef<any>(null)
  const [mapsReady, setMapsReady] = useState(false)
  const [mapType, setMapType] = useState<'roadmap' | 'hybrid'>('roadmap')

  // Load Google Maps JS API
  useEffect(() => {
    if (typeof window === 'undefined') return
    const win = window as any
    if (win.google?.maps) { setMapsReady(true); return }

    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    if (!key) return

    let alive = true
    win.__roofRadarMapsReady = () => { if (alive) setMapsReady(true) }

    if (!document.getElementById('gmaps-js')) {
      const script = document.createElement('script')
      script.id = 'gmaps-js'
      script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&callback=__roofRadarMapsReady`
      script.async = true
      document.head.appendChild(script)
    } else {
      const poll = setInterval(() => {
        if (win.google?.maps) { clearInterval(poll); if (alive) setMapsReady(true) }
      }, 50)
      return () => { alive = false; clearInterval(poll) }
    }
    return () => { alive = false }
  }, [])

  // Initialize map once
  useEffect(() => {
    if (!mapsReady || !containerRef.current || mapRef.current) return
    const google = (window as any).google

    const map = new google.maps.Map(containerRef.current, {
      center: { lat: 35.49, lng: -80.62 },
      zoom: 11,
      mapTypeId: 'roadmap',
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM },
    })

    mapRef.current = map
    infoWindowRef.current = new google.maps.InfoWindow({ maxWidth: 280 })

    // ZIP boundary polygons
    Object.entries(ZIP_POLYGONS).forEach(([zip, coords]) => {
      const paths = coords.map(([lat, lng]) => ({ lat, lng }))

      const polygon = new google.maps.Polygon({
        paths,
        strokeColor: '#294083',
        strokeOpacity: 0.85,
        strokeWeight: 1.5,
        fillColor: '#c9a84c',
        fillOpacity: 0.06,
        map,
      })
      polygon.addListener('click', () => setSelectedZip(zip))

      // ZIP label (invisible pin, just the label text)
      const cLat = coords.reduce((s, c) => s + c[0], 0) / coords.length
      const cLng = coords.reduce((s, c) => s + c[1], 0) / coords.length
      new google.maps.Marker({
        position: { lat: cLat, lng: cLng },
        map,
        clickable: false,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 },
        label: { text: zip, color: '#c9a84c', fontSize: '11px', fontWeight: '900' },
      })

      polygonsRef.current[zip] = polygon
    })

    return () => {
      markersRef.current.forEach((m) => m.setMap(null))
      Object.values(polygonsRef.current).forEach((p: any) => p.setMap(null))
      markersRef.current = []
      polygonsRef.current = {}
      mapRef.current = null
      infoWindowRef.current = null
    }
  }, [mapsReady, setSelectedZip])

  // Map type toggle
  useEffect(() => {
    mapRef.current?.setMapTypeId(mapType)
  }, [mapType])

  // Highlight selected ZIP + pan
  useEffect(() => {
    Object.entries(polygonsRef.current).forEach(([zip, polygon]) => {
      if (zip === selectedZip) {
        polygon.setOptions({ strokeColor: '#c9a84c', strokeWeight: 2.5, strokeOpacity: 1 })
        const coords = ZIP_POLYGONS[zip]
        if (coords && mapRef.current) {
          const cLat = coords.reduce((s, c) => s + c[0], 0) / coords.length
          const cLng = coords.reduce((s, c) => s + c[1], 0) / coords.length
          mapRef.current.panTo({ lat: cLat, lng: cLng })
          mapRef.current.setZoom(13)
        }
      } else {
        polygon.setOptions({ strokeColor: '#294083', strokeWeight: 1.5, strokeOpacity: 0.85 })
      }
    })
    if (!selectedZip && mapRef.current) {
      mapRef.current.panTo({ lat: 35.49, lng: -80.62 })
      mapRef.current.setZoom(11)
    }
  }, [selectedZip])

  // Update choropleth heat colors
  useEffect(() => {
    const byZip: Record<string, number> = {}
    const totals: Record<string, number> = {}
    filtered.forEach((p) => {
      totals[p.zip] = (totals[p.zip] || 0) + 1
      if (p.score === 'A' || p.score === 'B') byZip[p.zip] = (byZip[p.zip] || 0) + 1
    })
    Object.entries(polygonsRef.current).forEach(([zip, polygon]) => {
      if (!showHeatLayer) { polygon.setOptions({ fillOpacity: 0 }); return }
      const density = totals[zip] > 0 ? (byZip[zip] || 0) / totals[zip] : 0
      let fillColor = '#c9a84c'; let fillOpacity = 0.06
      if (density >= 0.6) { fillColor = '#e63535'; fillOpacity = 0.45 }
      else if (density >= 0.4) { fillColor = '#e63535'; fillOpacity = 0.25 }
      else if (density >= 0.2) { fillColor = '#f07040'; fillOpacity = 0.2 }
      polygon.setOptions({ fillColor, fillOpacity })
    })
  }, [filtered, showHeatLayer])

  // Update property markers
  useEffect(() => {
    if (!mapsReady || !mapRef.current) return
    const google = (window as any).google

    markersRef.current.forEach((m) => m.setMap(null))
    markersRef.current = []
    if (!showPins) return

    const display = mapTaggedOnly ? filtered.filter((p) => p.tagged) : filtered

    display.forEach((p) => {
      if (!p.lat || !p.lng) return
      const color = SCORE_COLOR[p.score]

      const marker = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: mapRef.current,
        title: p.street,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: p.tagged ? 9 : 7,
          fillColor: color,
          fillOpacity: 0.92,
          strokeColor: p.tagged ? '#2ecc87' : '#ffffff',
          strokeWeight: p.tagged ? 2.5 : 1,
        },
      })

      marker.addListener('click', () => {
        const content = document.createElement('div')
        content.innerHTML = `
          <div style="font-family:system-ui,sans-serif;padding:4px 0;min-width:220px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              <div style="background:${color};color:#fff;padding:3px 9px;border-radius:4px;font-size:11px;font-weight:900;letter-spacing:1px">${p.score}</div>
              <div style="font-size:11px;color:#777;font-weight:700;letter-spacing:1px;text-transform:uppercase">${p.status}</div>
              ${p.tagged ? '<div style="background:#1a5c3f;color:#a0f0cc;padding:3px 8px;border-radius:4px;font-size:10px;font-weight:900;letter-spacing:1px">TAGGED</div>' : ''}
            </div>
            <div style="font-weight:900;font-size:14px;color:#111;line-height:1.25;margin-bottom:2px">${p.street}</div>
            <div style="color:#666;font-size:12px;margin-bottom:10px">${p.city} · ${p.zip}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px;background:#f4f6fb;border-radius:6px;padding:8px">
              <div><div style="color:#888;font-size:9px;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px">Roof Age</div><strong style="font-size:13px;color:#111">${p.roofAge}yr</strong></div>
              <div><div style="color:#888;font-size:9px;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px">Value</div><strong style="font-size:13px;color:#111">$${Math.round(p.value / 1000)}K</strong></div>
              <div><div style="color:#888;font-size:9px;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px">Built</div><strong style="font-size:13px;color:#111">${p.yearBuilt}</strong></div>
              <div><div style="color:#888;font-size:9px;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px">Storm</div><strong style="font-size:13px;color:#111">${p.storm.hailEvents > 0 ? p.storm.maxHailInches + '" hail' : p.storm.windEvents + ' wind'}</strong></div>
            </div>
            <div style="display:flex;gap:6px">
              <button id="rr-tag-${p.id}" style="flex:1;background:${p.tagged ? '#1a5c3f' : '#c9a84c'};color:${p.tagged ? '#a0f0cc' : '#061221'};border:none;border-radius:5px;padding:9px 0;font-size:12px;font-weight:900;cursor:pointer;letter-spacing:0.5px">
                ${p.tagged ? '✓ Tagged' : '📌 Tag for Drop'}
              </button>
              <button id="rr-det-${p.id}" style="background:#e8eef8;color:#334;border:none;border-radius:5px;padding:9px 12px;font-size:12px;font-weight:700;cursor:pointer">Details →</button>
            </div>
          </div>`

        infoWindowRef.current.setContent(content)
        infoWindowRef.current.open(mapRef.current, marker)
        setTimeout(() => {
          document.getElementById(`rr-tag-${p.id}`)?.addEventListener('click', () => {
            onTag(p.id)
            infoWindowRef.current?.close()
          })
          document.getElementById(`rr-det-${p.id}`)?.addEventListener('click', () => {
            infoWindowRef.current?.close()
            onOpen(p)
          })
        }, 80)
      })

      markersRef.current.push(marker)
    })
  }, [filtered, showPins, mapTaggedOnly, onTag, onOpen, mapsReady])

  return (
    <div className="rr-map-wrap">
      {!mapsReady && (
        <div className="rr-map-loading">
          <div className="rr-scan-spinner" style={{ width: 26, height: 26, borderWidth: 3, marginRight: 12 }} />
          Loading Google Maps...
        </div>
      )}
      <div
        ref={containerRef}
        className="rr-map-container"
        style={{ display: mapsReady ? 'block' : 'none' }}
      />

      {/* Controls */}
      <div className="rr-map-controls">
        <button
          className={mapType === 'hybrid' ? 'on' : ''}
          onClick={() => setMapType(mapType === 'hybrid' ? 'roadmap' : 'hybrid')}
        >
          {mapType === 'hybrid' ? '🗺 Roadmap' : '🛰 Satellite'}
        </button>
        <button className={showHeatLayer ? 'on' : ''} onClick={() => setShowHeatLayer(!showHeatLayer)}>Heat</button>
        <button className={showPins ? 'on' : ''} onClick={() => setShowPins(!showPins)}>Pins</button>
        <button className={mapTaggedOnly ? 'on' : ''} onClick={() => setMapTaggedOnly(!mapTaggedOnly)}>Tagged Only</button>
        <button className="rr-route-btn" onClick={onBuildRoute}>🗺 Build Route</button>
      </div>

      {/* Legend */}
      <div className="rr-map-legend">
        <div className="rr-legend-title">Score</div>
        {(['A', 'B', 'C', 'D'] as Score[]).map((s) => (
          <div key={s} className="rr-legend-item">
            <span style={{ background: SCORE_COLOR[s] }} />
            {s} — {scoreLabel(s)}
          </div>
        ))}
        <div className="rr-legend-title" style={{ marginTop: 10 }}>ZIP Density</div>
        <div className="rr-legend-item"><span style={{ background: 'rgba(201,168,76,0.5)' }} />Low</div>
        <div className="rr-legend-item"><span style={{ background: 'rgba(240,112,64,0.6)' }} />Medium</div>
        <div className="rr-legend-item"><span style={{ background: 'rgba(230,53,53,0.75)' }} />High</div>
      </div>
    </div>
  )
}

// ---- ZIP PANEL ----

function ZipPanel({
  zipStats, selectedZip, setSelectedZip, onDrill,
}: {
  zipStats: ZipStat[]
  selectedZip: string | null
  setSelectedZip: (zip: string | null) => void
  onDrill: (zip: string) => void
}) {
  return (
    <div className="rr-zip-panel-header-wrap">
      <div className="rr-zip-panel-header">
        <h2>ZIP Intelligence</h2>
        <span>{zipStats.length} zones</span>
      </div>
      <div className="rr-zip-list">
        {zipStats.length === 0 && (
          <p style={{ color: 'var(--muted)', padding: '20px', fontSize: 13 }}>No results in current filters.</p>
        )}
        {zipStats.map((stat) => (
          <div
            key={stat.zip}
            className={`rr-zip-card ${selectedZip === stat.zip ? 'selected' : ''}`}
            onClick={() => setSelectedZip(selectedZip === stat.zip ? null : stat.zip)}
          >
            <div className="rr-zip-card-top">
              <div className="rr-zip-number">{stat.zip}</div>
              <div className="rr-zip-city">{ZIP_CITIES[stat.zip] || 'Cabarrus Co.'}</div>
              <div className={`rr-zip-badge ${stat.badge.toLowerCase()}`}>{stat.badge}</div>
            </div>
            <div className="rr-zip-bars">
              <div className="rr-zip-bar-row">
                <span>Roof Age</span>
                <div className="rr-zip-bar-track">
                  <div className="rr-zip-bar-fill" style={{ width: `${Math.min(100, (stat.avgAge / 40) * 100)}%` }} />
                </div>
                <strong>{stat.avgAge}yr</strong>
              </div>
              <div className="rr-zip-bar-row">
                <span>A-Score</span>
                <div className="rr-zip-bar-track">
                  <div className="rr-zip-bar-fill red" style={{ width: `${(stat.aCount / stat.total) * 100}%` }} />
                </div>
                <strong>{stat.aCount}</strong>
              </div>
              <div className="rr-zip-bar-row">
                <span>Storms</span>
                <div className="rr-zip-bar-track">
                  <div className="rr-zip-bar-fill orange" style={{ width: `${(stat.stormCount / stat.total) * 100}%` }} />
                </div>
                <strong>{stat.stormCount}</strong>
              </div>
            </div>
            <div className="rr-zip-stats">
              <div><small>Total</small><span>{stat.total}</span></div>
              <div><small>Priority A</small><span>{stat.aCount}</span></div>
              <div><small>Avg Value</small><span>${Math.round(stat.avgValue / 1000)}K</span></div>
            </div>
            <button className="rr-zip-drill-btn" onClick={(e) => { e.stopPropagation(); onDrill(stat.zip) }}>
              Drill Into ZIP →
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- SCAN OVERLAY ----

function ScanOverlay({ step }: { step: number }) {
  return (
    <div className="rr-scan-mask">
      <div className="rr-scan-modal">
        <div className="rr-scan-header">
          <div className="rr-scan-spinner" />
          <span>Scanning Area...</span>
        </div>
        {SCAN_STEPS.map((label, i) => (
          <div key={label} className={`rr-scan-step ${i < step ? 'done' : i === step ? 'active' : ''}`}>
            <span className="rr-scan-step-icon">
              {i < step ? '✓' : i === step ? '▶' : '○'}
            </span>
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- TOAST STACK ----

function ToastStack({ toasts }: { toasts: Toast[] }) {
  if (!toasts.length) return null
  return (
    <div className="rr-toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`rr-toast ${t.type}`}>{t.message}</div>
      ))}
    </div>
  )
}

// ---- SHARED UI COMPONENTS ----

const DEFAULT_SOURCES: SourceStatus[] = [
  { key: 'listings', label: 'Listing Feed', provider: 'not configured', configured: false, cadence: 'provider-dependent', note: 'Connect ListHub, PropAPIS, RealtyAPI, MLS Grid, Bridge, or Spark through the server adapter.' },
  { key: 'public-records', label: 'Public Records', provider: 'county assessor/open-data endpoint', configured: false, cadence: 'daily/weekly by county source', note: 'Free county assessor, parcel, and tax portals are market-by-market.' },
  { key: 'permits', label: 'Roof Permits', provider: 'county permit/open-data endpoint', configured: false, cadence: 'county/provider-dependent', note: 'Use Socrata or ArcGIS open-data APIs when the target county publishes permits.' },
  { key: 'storm', label: 'Storm History', provider: 'NOAA/SPC public storm reports', configured: true, cadence: 'daily plus post-event refresh', note: 'Hail and damaging wind events enrich property priority.' },
  { key: 'geocoder', label: 'Geocoder', provider: 'US Census Geocoder', configured: true, cadence: 'on demand', note: 'Free address-to-coordinate fallback for storm matching.' },
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
    <button type="button" onClick={onClick} className="rr-path-btn">
      <strong>{title}</strong>
      <span>{sub}</span>
    </button>
  )
}

function Range(props: { label: string; value: number; min: number; max: number; suffix: string; onChange: (v: number) => void }) {
  return (
    <div className="rr-range-row">
      <label>{props.label}</label>
      <input type="range" value={props.value} min={props.min} max={props.max} onChange={(e) => props.onChange(Number(e.target.value))} />
      <strong>{props.value}{props.suffix === 'yrs' ? '' : ` ${props.suffix}`}</strong>
    </div>
  )
}

function PropertyCard({ property, onOpen, onTag }: { property: RadarProperty; onOpen: () => void; onTag: () => void }) {
  return (
    <article className={`rr-card ${property.tagged ? 'tagged' : ''}`}>
      <div className={`rr-card-band ${property.score}`} />
      <div className="rr-card-head">
        <ScoreBadge score={property.score} />
        <button onClick={onOpen} className="text-left min-w-0">
          <span className="rr-card-title">{property.street}</span>
          <span className="rr-card-sub">{property.city} · {property.zip} · {property.source}</span>
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
          {property.signals.slice(0, 3).map((sig) => (
            <span key={sig} className="rr-signal">{sig}</span>
          ))}
        </div>
        <div className="rr-card-actions">
          <button onClick={onTag} title="Tag for drop">{property.tagged ? '✓' : '📌'}</button>
          <button onClick={onOpen} title="Open detail">→</button>
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

function scoreLabel(score: Score) {
  switch (score) {
    case 'A': return 'Critical'
    case 'B': return 'High'
    case 'C': return 'Medium'
    case 'D': return 'Low'
  }
}
