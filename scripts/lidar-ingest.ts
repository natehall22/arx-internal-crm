/**
 * Lidar ingest worker — pulls USGS lidar tiles, keeps building points, stores them in
 * the `lidar-buildings` bucket and marks `lidar_tiles` ready. Runs on any machine with
 * the service key in .env.local (bootstrapped on Nathan's Mac; no paid compute).
 *
 *   npm run lidar:ingest -- plan [--counties Cabarrus,Rowan] [--all-tiles]
 *       Queue tiles. Default: only tiles holding an opportunity, measurement or lead,
 *       prioritised so tiles with real jobs go first.
 *   npm run lidar:ingest -- run [--limit 50] [--concurrency 3]
 *       Process the queue, highest priority first. Safe to stop and restart.
 *   npm run lidar:ingest -- status
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { buildingPointsFromLaz } from '../lib/lidar/laz-building-points'
import { encodeTilePoints } from '../lib/lidar/tile-store'
import { LIDAR_BUILDINGS_BUCKET, NC_LIDAR_DATASETS, lidarStoragePath, lidarTileId, type LidarDataset } from '../lib/lidar/sources'

for (const filename of ['.env.local', '.env']) {
  const p = resolve(process.cwd(), filename)
  if (!existsSync(p)) continue
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m || process.env[m[1]] != null) continue
    process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
  }
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const args = process.argv.slice(2)
const cmd = args[0]
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const has = (name: string) => args.includes(`--${name}`)

type VpcTile = { name: string; bbox: [number, number, number, number]; href: string }

async function loadVpc(ds: LidarDataset): Promise<VpcTile[]> {
  const res = await fetch(`${ds.baseUrl}/${ds.workunit}.vpc`)
  if (!res.ok) throw new Error(`${ds.county} index HTTP ${res.status}`)
  const vpc = await res.json()
  return vpc.features.map((f: any) => {
    const b = f.bbox as number[] // [minLng, minLat, minZ, maxLng, maxLat, maxZ]
    const wkt = String(f.properties?.['proj:wkt2'] ?? '')
    if (!wkt.includes('North Carolina (ftUS)')) throw new Error(`${ds.county}: unexpected CRS, not NC State Plane ftUS`)
    const href = String(Object.values(f.assets as Record<string, { href: string }>)[0].href).replace(/^\.\//, '')
    return { name: String(f.id), bbox: [b[0], b[1], b[3], b[4]], href: `${ds.baseUrl}/${href}` }
  })
}

async function allRows(table: string) {
  const out: { lat: number; lng: number }[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select('lat, lng').not('lat', 'is', null).not('lng', 'is', null).range(from, from + 999)
    if (error) throw error
    out.push(...(data as any[]).map((r) => ({ lat: Number(r.lat), lng: Number(r.lng) })))
    if (!data || data.length < 1000) break
  }
  return out
}

async function plan() {
  const wanted = flag('counties')?.split(',').map((s) => s.trim().toLowerCase())
  const datasets = NC_LIDAR_DATASETS.filter((d) => !wanted || wanted.includes(d.county.toLowerCase()))
  const [opps, meas, leads] = await Promise.all([allRows('opportunities'), allRows('roof_measurements'), allRows('leads')])
  let queued = 0
  for (const ds of datasets) {
    const tiles = await loadVpc(ds)
    const score = new Map<string, number>()
    const tally = (pts: { lat: number; lng: number }[], w: number) => {
      for (const p of pts) {
        const t = tiles.find((t) => t.bbox[0] <= p.lng && p.lng <= t.bbox[2] && t.bbox[1] <= p.lat && p.lat <= t.bbox[3])
        if (t) score.set(t.name, (score.get(t.name) || 0) + w)
      }
    }
    tally(opps, 20); tally(meas, 20); tally(leads, 1)
    const rows = tiles
      .filter((t) => has('all-tiles') || score.has(t.name))
      .map((t) => ({
        id: lidarTileId(ds.workunit, t.name), dataset: ds.workunit, tile_name: t.name, source_url: t.href,
        min_lng: t.bbox[0], min_lat: t.bbox[1], max_lng: t.bbox[2], max_lat: t.bbox[3],
        collected_end: ds.collectedEnd, priority: score.get(t.name) || 0,
      }))
    for (let i = 0; i < rows.length; i += 500) {
      // ignoreDuplicates: re-planning never resets a tile that is already ready/processing
      const { error } = await db.from('lidar_tiles').upsert(rows.slice(i, i + 500), { onConflict: 'id', ignoreDuplicates: true })
      if (error) throw error
    }
    queued += rows.length
    console.log(`${ds.county}: ${tiles.length} tiles, ${rows.length} queued (${rows.filter((r) => r.priority >= 20).length} with a job)`)
  }
  console.log(`queued ${queued}`)
}

/** USGS rockyweb throttles per connection (~300 KB/s); 8 parallel ranges ≈ 4× faster. */
async function download(url: string, parts = 8): Promise<Uint8Array> {
  const head = await fetch(url, { method: 'HEAD' })
  const size = Number(head.headers.get('content-length'))
  if (!head.ok || !size) throw new Error(`HEAD ${head.status}`)
  const out = new Uint8Array(size)
  const chunk = Math.ceil(size / parts)
  await Promise.all(Array.from({ length: parts }, async (_, i) => {
    const start = i * chunk
    const end = Math.min(size, start + chunk) - 1
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } })
        if (r.status !== 206) throw new Error(`range HTTP ${r.status}`)
        const buf = new Uint8Array(await r.arrayBuffer())
        if (buf.length !== end - start + 1) throw new Error('short range')
        out.set(buf, start)
        return
      } catch (e) {
        if (attempt >= 4) throw e
        await new Promise((r) => setTimeout(r, 2000 * attempt))
      }
    }
  }))
  return out
}

async function processTile(row: any) {
  const t0 = Date.now()
  const laz = await download(row.source_url)
  const { total, xyz } = await buildingPointsFromLaz(laz)
  const gz = encodeTilePoints(xyz)
  const path = lidarStoragePath(row.dataset, row.tile_name)
  const { error: upErr } = await db.storage.from(LIDAR_BUILDINGS_BUCKET).upload(path, gz, { contentType: 'application/gzip', upsert: true })
  if (upErr) throw upErr
  const { error } = await db.from('lidar_tiles').update({
    status: 'ready', storage_path: path, total_points: total, building_points: xyz.length / 3,
    stored_bytes: gz.length, error: null, processed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', row.id)
  if (error) throw error
  console.log(`✓ ${row.tile_name}  ${(laz.length / 1e6).toFixed(0)} MB → ${xyz.length / 3} bldg pts, ${(gz.length / 1e6).toFixed(1)} MB  ${Math.round((Date.now() - t0) / 1000)}s`)
}

async function claim(): Promise<any | null> {
  const { data } = await db.from('lidar_tiles').select('*').in('status', ['pending', 'failed']).lt('attempts', 3)
    .order('priority', { ascending: false }).limit(10)
  for (const row of data ?? []) {
    const { data: got } = await db.from('lidar_tiles')
      .update({ status: 'processing', attempts: row.attempts + 1, updated_at: new Date().toISOString() })
      .eq('id', row.id).in('status', ['pending', 'failed']).select().maybeSingle()
    if (got) return got
  }
  return null
}

async function run() {
  const limit = Number(flag('limit') || Infinity)
  const concurrency = Number(flag('concurrency') || 3)
  let done = 0
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (done < limit) {
      const row = await claim()
      if (!row) return
      done++
      try {
        await processTile(row)
      } catch (e: any) {
        console.error(`✗ ${row.tile_name}: ${e?.message ?? e}`)
        await db.from('lidar_tiles').update({ status: 'failed', error: String(e?.message ?? e).slice(0, 500), updated_at: new Date().toISOString() }).eq('id', row.id)
      }
    }
  }))
  console.log(`processed ${done}`)
}

async function status() {
  const { data } = await db.from('lidar_tiles').select('dataset, status, stored_bytes')
  const agg = new Map<string, { n: number; mb: number }>()
  for (const r of data ?? []) {
    const k = `${r.dataset} ${r.status}`
    const a = agg.get(k) ?? { n: 0, mb: 0 }
    a.n++; a.mb += (r.stored_bytes ?? 0) / 1e6
    agg.set(k, a)
  }
  for (const [k, a] of Array.from(agg.entries()).sort()) console.log(k.padEnd(40), String(a.n).padStart(5), `${a.mb.toFixed(0)} MB`)
}

;({ plan, run, status } as Record<string, () => Promise<void>>)[cmd]?.()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  ?? console.log('usage: lidar-ingest plan|run|status')
