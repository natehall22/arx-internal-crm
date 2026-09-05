const USER_AGENT = 'ARX-permit-audit/0.1'
const DEFAULT_PAGE_SIZE = 1000
const REQUEST_DELAY_MS = 400

export type ArcGISGeometry = {
  /** Point layers. */
  x?: number
  y?: number
  /** Polygon layers (parcel outlines). */
  rings?: number[][][]
}

export type ArcGISFeature = {
  attributes: Record<string, unknown>
  /** Only populated when a caller passes returnGeometry: true. */
  geometry?: ArcGISGeometry
}

export type ArcGISQueryResult = {
  features: ArcGISFeature[]
  exceededTransferLimit?: boolean
  count?: number
  error?: { code?: number; message?: string }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let lastRequestAt = 0

async function throttle(delayMs = REQUEST_DELAY_MS): Promise<void> {
  const elapsed = Date.now() - lastRequestAt
  if (elapsed < delayMs) {
    await sleep(delayMs - elapsed)
  }
  lastRequestAt = Date.now()
}

function buildQueryUrl(
  layerUrl: string,
  params: Record<string, string | number | boolean>,
): string {
  const url = new URL(`${layerUrl.replace(/\/$/, '')}/query`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

export async function queryArcGISLayer(options: {
  layerUrl: string
  where: string
  outFields?: string
  resultRecordCount?: number
  resultOffset?: number
  returnCountOnly?: boolean
  delayMs?: number
  /** Off by default so existing audit callers are unaffected. */
  returnGeometry?: boolean
}): Promise<ArcGISQueryResult> {
  await throttle(options.delayMs)

  const url = buildQueryUrl(options.layerUrl, {
    where: options.where,
    outFields: options.outFields ?? '*',
    f: 'json',
    returnGeometry: options.returnGeometry === true,
    // Counties publish in state-plane; ask for WGS84 so coordinates are usable
    // as map lat/lng without reprojection.
    ...(options.returnGeometry ? { outSR: 4326 } : {}),
    ...(options.returnCountOnly ? { returnCountOnly: true } : {}),
    ...(options.resultRecordCount != null
      ? { resultRecordCount: options.resultRecordCount }
      : {}),
    ...(options.resultOffset != null && options.resultOffset > 0
      ? { resultOffset: options.resultOffset }
      : {}),
  })

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  })

  if (!res.ok) {
    throw new Error(`ArcGIS HTTP ${res.status} for ${options.layerUrl}`)
  }

  const body = (await res.json()) as ArcGISQueryResult
  if (body.error) {
    throw new Error(
      `ArcGIS error ${body.error.code ?? '?'}: ${body.error.message ?? 'unknown'}`,
    )
  }
  return body
}

/** Count all features matching `where`, paginating when transfer limit is exceeded. */
export async function countArcGISFeatures(
  layerUrl: string,
  where: string,
): Promise<number> {
  const first = await queryArcGISLayer({
    layerUrl,
    where,
    returnCountOnly: true,
  })
  if (typeof first.count === 'number') {
    return first.count
  }

  let total = 0
  let offset = 0
  for (;;) {
    const page = await queryArcGISLayer({
      layerUrl,
      where,
      outFields: 'OBJECTID',
      resultRecordCount: DEFAULT_PAGE_SIZE,
      resultOffset: offset,
    })
    total += page.features.length
    if (!page.exceededTransferLimit && page.features.length < DEFAULT_PAGE_SIZE) {
      break
    }
    if (page.features.length === 0) {
      break
    }
    offset += page.features.length
  }
  return total
}

/** Fetch up to `limit` features (paginated). */
export async function fetchArcGISFeatures(
  layerUrl: string,
  where: string,
  limit: number,
  outFields = '*',
): Promise<ArcGISFeature[]> {
  const collected: ArcGISFeature[] = []
  let offset = 0

  while (collected.length < limit) {
    const pageSize = Math.min(DEFAULT_PAGE_SIZE, limit - collected.length)
    const page = await queryArcGISLayer({
      layerUrl,
      where,
      outFields,
      resultRecordCount: pageSize,
      resultOffset: offset,
    })
    collected.push(...page.features)
    if (page.features.length < pageSize) {
      break
    }
    offset += page.features.length
  }

  return collected.slice(0, limit)
}

/** Fetch every matching feature, paginating past maxRecordCount. */
export async function fetchAllArcGISFeatures(
  layerUrl: string,
  where: string,
  outFields = '*',
  options?: { pageSize?: number; delayMs?: number; returnGeometry?: boolean },
): Promise<ArcGISFeature[]> {
  const collected: ArcGISFeature[] = []
  let offset = 0
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE

  for (;;) {
    const page = await queryArcGISLayer({
      layerUrl,
      where,
      outFields,
      resultRecordCount: pageSize,
      delayMs: options?.delayMs,
      returnGeometry: options?.returnGeometry,
      ...(offset > 0 ? { resultOffset: offset } : {}),
    })
    collected.push(...page.features)
    if (page.features.length === 0) break
    offset += page.features.length
    const mightHaveMore =
      page.exceededTransferLimit === true || page.features.length >= pageSize
    if (!mightHaveMore) break
  }
  return collected
}

/** ArcGIS stores dates as epoch ms or ISO strings. Returns YYYY-MM-DD or null. */
export function parseArcGisDate(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10)
  }
  const s = String(value).trim()
  if (!s) return null
  const dotted = s.match(/^(\d{4})[./-](\d{2})[./-](\d{2})/)
  if (dotted) return `${dotted[1]}-${dotted[2]}-${dotted[3]}`
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10)
  }
  return s
}

export { USER_AGENT }
