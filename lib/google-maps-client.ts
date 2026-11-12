/**
 * Browser-side Google Maps loader for the Measure yard tool: loads the script once, with the `geometry` library
 * (`computeArea` / `computeLength`), and reads the key from the same env var every other map screen uses
 * (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).
 *
 * Why this file exists: the app has NO shared loader today. Four screens each inject their own <script> tag
 * (components/LocationMap.tsx, components/canvass-territories/CanvassTerritoriesEditor.tsx, the canvass map, the roof
 * measure page) — Known Redundancy in CLAUDE.md. The roof measure page is off limits for this tool, and the others differ in which
 * libraries they ask for, so this is the one loader for NEW map screens; migrate the other copies onto it when touched.
 *
 * Client navigation keeps the page's window: if another screen already added the script WITHOUT `geometry`, the
 * library is requested through `google.maps.importLibrary` (present in current Maps builds), never by loading a second script.
 */

type MapsWindow = { google?: { maps?: any } }

let loading: Promise<void> | null = null

const SCRIPT_MARK = 'data-yard-maps'

function hasGeometry(): boolean {
  const g = (window as unknown as MapsWindow).google
  return !!g?.maps?.geometry?.spherical
}

function ready(): boolean {
  const g = (window as unknown as MapsWindow).google
  return !!g?.maps?.Map
}

async function ensureGeometry(): Promise<void> {
  if (hasGeometry()) return
  const maps = (window as unknown as MapsWindow).google?.maps
  if (maps && typeof maps.importLibrary === 'function') {
    await maps.importLibrary('geometry')
  }
  if (!hasGeometry()) throw new Error('Google Maps measuring library did not load')
}

/** The key the app's other map screens use. A caller (the dev harness) may pass its own. */
export function googleMapsKey(override?: string): string | undefined {
  return override || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || undefined
}

export function loadGoogleMaps(opts: { apiKey?: string } = {}): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Google Maps loads in the browser only'))
  if (ready()) return ensureGeometry()
  if (loading) return loading
  const key = googleMapsKey(opts.apiKey)
  if (!key) return Promise.reject(new Error('The map key is not set up for this company yet'))
  loading = new Promise<void>((resolve, reject) => {
    const fail = (message: string) => {
      loading = null
      reject(new Error(message))
    }
    const finish = () => {
      if (!ready()) return fail('Google Maps did not start')
      ensureGeometry().then(resolve, (e) => fail(e instanceof Error ? e.message : 'Google Maps did not start'))
    }
    const existing = document.querySelector<HTMLScriptElement>('script[src*="maps.googleapis.com/maps/api/js"]')
    if (existing) {
      // Another screen's script tag (maybe still loading): wait for it instead of adding a second one.
      if (ready()) return finish()
      existing.addEventListener('load', finish, { once: true })
      existing.addEventListener('error', () => fail('Failed to load Google Maps'), { once: true })
      return
    }
    const s = document.createElement('script')
    s.setAttribute(SCRIPT_MARK, '1')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=geometry&v=weekly`
    s.async = true
    s.onload = finish
    s.onerror = () => fail('Failed to load Google Maps')
    document.head.appendChild(s)
  })
  return loading
}

/** Square metres / metres, the way Google measures them (spherical, on the same earth radius as the rest of Maps). */
export function measurePolygonSqm(path: Array<{ lat: number; lng: number }>): number {
  const g = (window as unknown as MapsWindow).google!.maps
  return g.geometry.spherical.computeArea(path.map((p) => new g.LatLng(p.lat, p.lng)))
}

export function measureLineMeters(path: Array<{ lat: number; lng: number }>): number {
  const g = (window as unknown as MapsWindow).google!.maps
  return g.geometry.spherical.computeLength(path.map((p) => new g.LatLng(p.lat, p.lng)))
}
