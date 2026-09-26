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
 *   npm run lidar:ingest -- run --remote https://<app>/api/cron/lidar-ingest
 *       Same, but through the cron endpoint with CRON_SECRET instead of the service key —
 *       how the GitHub Actions workflow runs it (.github/workflows/lidar-ingest.yml).
 *   npm run lidar:ingest -- status
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { buildingPointsFromLaz } from '../lib/lidar/laz-building-points'
import { encodeTilePoints } from '../lib/lidar/tile-store'
import { NC_LIDAR_DATASETS, lidarStoragePath, lidarTileId, type LidarDataset } from '../lib/lidar/sources'
import {
  claimNextTile,
  completeTile,
  createTileUploadTarget,
  downloadWithRanges,
  failTile,
  type LidarTileRow,
} from '../lib/lidar/ingest-queue'

for (const filename of ['.env.local', '.env']) {
  const p = resolve(process.cwd(), filename)
  if (!existsSync(p)) continue
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m || process.env[m[1]] != null) continue
    process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
  }
}
let dbClient: SupabaseClient | null = null
function serviceDb(): SupabaseClient {
  dbClient ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return dbClient
}

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
    const { data, error } = await serviceDb().from(table).select('lat, lng').not('lat', 'is', null).not('lng', 'is', null).range(from, from + 999)
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
      const { error } = await serviceDb().from('lidar_tiles').upsert(rows.slice(i, i + 500), { onConflict: 'id', ignoreDuplicates: true })
      if (error) throw error
    }
    queued += rows.length
    console.log(`${ds.county}: ${tiles.length} tiles, ${rows.length} queued (${rows.filter((r) => r.priority >= 20).length} with a job)`)
  }
  console.log(`queued ${queued}`)
}

/** Where tiles come from and go to: straight to the DB (service key) or via the cron endpoint. */
type Queue = {
  claim(): Promise<{ tile: LidarTileRow; signedUrl: string } | null>
  complete(tile: LidarTileRow, stats: { totalPoints: number; buildingPoints: number; storedBytes: number; storagePath: string }): Promise<void>
  fail(tile: LidarTileRow, message: string): Promise<void>
}

const localQueue: Queue = {
  async claim() {
    const tile = await claimNextTile(serviceDb())
    if (!tile) return null
    const { signedUrl } = await createTileUploadTarget(serviceDb(), tile)
    return { tile, signedUrl }
  },
  complete: (tile, stats) => completeTile(serviceDb(), tile.id, stats),
  fail: (tile, message) => failTile(serviceDb(), tile.id, message),
}

function remoteQueue(endpoint: string): Queue {
  const secret = process.env.CRON_SECRET
  if (!secret) throw new Error('CRON_SECRET is required for --remote')
  const call = async (body: Record<string, unknown>) => {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`${body.action} HTTP ${r.status}: ${json?.error ?? ''}`)
    return json
  }
  return {
    async claim() {
      const res = await call({ action: 'claim' })
      return res.tile ? { tile: res.tile, signedUrl: res.upload.signedUrl } : null
    },
    async complete(tile, stats) {
      await call({ action: 'complete', id: tile.id, totalPoints: stats.totalPoints, buildingPoints: stats.buildingPoints, storedBytes: stats.storedBytes })
    },
    async fail(tile, message) {
      await call({ action: 'fail', id: tile.id, error: message })
    },
  }
}

async function processTile(queue: Queue, tile: LidarTileRow, signedUrl: string) {
  const t0 = Date.now()
  const laz = await downloadWithRanges(tile.source_url)
  const { total, xyz } = await buildingPointsFromLaz(laz)
  const gz = encodeTilePoints(xyz)
  const put = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': 'application/gzip', 'x-upsert': 'true' }, body: new Uint8Array(gz) })
  if (!put.ok) throw new Error(`upload HTTP ${put.status}`)
  await queue.complete(tile, {
    totalPoints: total,
    buildingPoints: xyz.length / 3,
    storedBytes: gz.length,
    storagePath: lidarStoragePath(tile.dataset, tile.tile_name),
  })
  console.log(`✓ ${tile.tile_name}  ${(laz.length / 1e6).toFixed(0)} MB → ${xyz.length / 3} bldg pts, ${(gz.length / 1e6).toFixed(1)} MB  ${Math.round((Date.now() - t0) / 1000)}s`)
}

async function run() {
  const limit = Number(flag('limit') || Infinity)
  const concurrency = Number(flag('concurrency') || 3)
  const remote = flag('remote')
  // Stop taking new tiles after this long so a CI job ends cleanly inside its time limit.
  const deadline = Date.now() + Number(flag('minutes') || Infinity) * 60_000
  const queue = remote ? remoteQueue(remote) : localQueue
  let done = 0
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (done < limit && Date.now() < deadline) {
      const claimed = await queue.claim()
      if (!claimed) return
      done++
      try {
        await processTile(queue, claimed.tile, claimed.signedUrl)
      } catch (e: any) {
        console.error(`✗ ${claimed.tile.tile_name}: ${e?.message ?? e}`)
        await queue.fail(claimed.tile, String(e?.message ?? e)).catch(() => {})
      }
    }
  }))
  console.log(`processed ${done}`)
}

async function status() {
  const { data } = await serviceDb().from('lidar_tiles').select('dataset, status, stored_bytes')
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
