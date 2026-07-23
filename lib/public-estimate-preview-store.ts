import { PUBLIC_ESTIMATE_TOKEN_TTL_MS, getPublicEstimateOrgId } from '@/lib/public-estimate-config'
import { createServiceClient } from '@/lib/supabase/service'

/** Measurement snapshot kept server-side only — never in the signed preview token. */
export type PublicEstimatePreviewSnapshot = {
  jti: string
  address: string
  lat: number
  lng: number
  squares_mid: number
  squares_low: number
  squares_high: number
  waste_percent: number
  facet_count: number
  measure_source: string
  requires_manual_measure: boolean
  expiresAt: number
}

type PublicEstimatePreviewRow = {
  jti: string
  org_id: string
  address: string
  lat: number
  lng: number
  squares_mid: number
  squares_low: number
  squares_high: number
  waste_percent: number
  facet_count: number
  measure_source: string
  requires_manual_measure: boolean
  expires_at: string
}

function rowToSnapshot(row: PublicEstimatePreviewRow): PublicEstimatePreviewSnapshot {
  return {
    jti: row.jti,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    squares_mid: Number(row.squares_mid),
    squares_low: Number(row.squares_low),
    squares_high: Number(row.squares_high),
    waste_percent: Number(row.waste_percent),
    facet_count: row.facet_count,
    measure_source: row.measure_source,
    requires_manual_measure: row.requires_manual_measure,
    expiresAt: new Date(row.expires_at).getTime(),
  }
}

/**
 * Persist preview snapshots in Supabase keyed by `jti` so preview and unlock
 * requests can land on different Vercel serverless instances.
 */
export async function storePublicEstimatePreview(
  snapshot: Omit<PublicEstimatePreviewSnapshot, 'expiresAt'>,
  options?: { ttlMs?: number; now?: number }
): Promise<PublicEstimatePreviewSnapshot> {
  const now = options?.now ?? Date.now()
  const ttl = options?.ttlMs ?? PUBLIC_ESTIMATE_TOKEN_TTL_MS
  const expiresAt = now + ttl
  const expires_at = new Date(expiresAt).toISOString()

  const adminClient = createServiceClient()
  const { error } = await adminClient.from('public_estimate_previews').upsert({
    jti: snapshot.jti,
    org_id: getPublicEstimateOrgId(),
    address: snapshot.address,
    lat: snapshot.lat,
    lng: snapshot.lng,
    squares_mid: snapshot.squares_mid,
    squares_low: snapshot.squares_low,
    squares_high: snapshot.squares_high,
    waste_percent: snapshot.waste_percent,
    facet_count: snapshot.facet_count,
    measure_source: snapshot.measure_source,
    requires_manual_measure: snapshot.requires_manual_measure,
    expires_at,
  })

  if (error) {
    console.error('[public-estimate] preview store write failed:', error)
    throw new Error('preview_store_failed')
  }

  return { ...snapshot, expiresAt }
}

export async function getPublicEstimatePreview(
  jti: string,
  options?: { now?: number }
): Promise<PublicEstimatePreviewSnapshot | null> {
  const now = options?.now ?? Date.now()
  const nowIso = new Date(now).toISOString()

  const adminClient = createServiceClient()
  const { data, error } = await adminClient
    .from('public_estimate_previews')
    .select('*')
    .eq('jti', jti)
    .gt('expires_at', nowIso)
    .maybeSingle()

  if (error) {
    console.error('[public-estimate] preview store read failed:', error)
    throw new Error('preview_store_read_failed')
  }

  if (!data) return null
  return rowToSnapshot(data as PublicEstimatePreviewRow)
}

export async function deletePublicEstimatePreview(jti: string): Promise<void> {
  const adminClient = createServiceClient()
  const { error } = await adminClient.from('public_estimate_previews').delete().eq('jti', jti)

  if (error) {
    console.error('[public-estimate] preview store delete failed:', error)
  }
}

/** Test helper — clears snapshots between unit tests. */
export async function resetPublicEstimatePreviewStoreForTests(): Promise<void> {
  const adminClient = createServiceClient()
  await adminClient.from('public_estimate_previews').delete().neq('jti', '')
}
