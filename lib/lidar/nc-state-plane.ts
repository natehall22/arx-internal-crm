/**
 * NC State Plane (NAD83(2011), US survey feet — EPSG:6543) ↔ WGS84, and local metres.
 *
 * Every NC Phase 4 lidar tile is delivered in this CRS with NAVD88 heights in US
 * survey feet, so it is the one frame lidar roof work runs in. NAD83(2011) and WGS84
 * differ by ~1 m here — below what a roof measurement cares about, and identical for
 * the pin and the points, so relative geometry is unaffected.
 */
import proj4 from 'proj4'

export const NC_STATE_PLANE_FTUS =
  '+proj=lcc +lat_0=33.75 +lon_0=-79 +lat_1=36.1666666666667 +lat_2=34.3333333333333 ' +
  '+x_0=609601.22 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=us-ft +no_defs'

/** One US survey foot in metres. */
export const US_SURVEY_FOOT_M = 1200 / 3937

export function wgs84ToNcFt(lat: number, lng: number): [number, number] {
  const [x, y] = proj4('EPSG:4326', NC_STATE_PLANE_FTUS, [lng, lat])
  return [x, y]
}

export function ncFtToWgs84(x: number, y: number): { lat: number; lng: number } {
  const [lng, lat] = proj4(NC_STATE_PLANE_FTUS, 'EPSG:4326', [x, y])
  return { lat, lng }
}
