/**
 * Compact on-disk format for one lidar tile's BUILDING points (USGS class 6).
 *
 * Why our own format: USGS ships Cabarrus as ~110 MB LAZ tiles off a ~300 KB/s
 * server, far too slow to fetch while a rep waits. The ingest worker extracts the
 * ~3% of points that are buildings once and stores them here (~2–3 MB per tile),
 * so a roof lookup is a single small download.
 *
 * Coordinates stay in NC State Plane (NAD83(2011), US survey feet — EPSG:6543), the
 * CRS every NC Phase 4 tile already uses: no reprojection error, and one CRS for
 * every county we work. Each axis is a uint16 offset from the tile origin at
 * `scaleFt` resolution (0.05 ft = 1.5 cm; a 2,500 ft tile needs 50,000 steps).
 *
 * Layout (little-endian), gzip'd as a whole:
 *   "ARXL" | u8 version | u8 reserved×3 | u32 count | f64 originX | f64 originY |
 *   f64 originZ | f32 scaleFt | count × (u16 x, u16 y, u16 z)
 */
import { gunzipSync, gzipSync } from 'node:zlib'

export const TILE_STORE_CRS = 'EPSG:6543'
const MAGIC = 'ARXL'
const VERSION = 1
const HEADER_BYTES = 4 + 4 + 4 + 8 * 3 + 4

export type TilePoints = {
  /** Flat [x, y, z, x, y, z, …] in EPSG:6543 US survey feet. */
  xyz: Float64Array
}

export function encodeTilePoints(xyzFt: Float64Array, scaleFt = 0.05): Buffer {
  const count = xyzFt.length / 3
  let minX = Infinity, minY = Infinity, minZ = Infinity
  for (let i = 0; i < xyzFt.length; i += 3) {
    if (xyzFt[i] < minX) minX = xyzFt[i]
    if (xyzFt[i + 1] < minY) minY = xyzFt[i + 1]
    if (xyzFt[i + 2] < minZ) minZ = xyzFt[i + 2]
  }
  if (count === 0) { minX = 0; minY = 0; minZ = 0 }
  const buf = Buffer.alloc(HEADER_BYTES + count * 6)
  buf.write(MAGIC, 0, 'ascii')
  buf.writeUInt8(VERSION, 4)
  buf.writeUInt32LE(count, 8)
  buf.writeDoubleLE(minX, 12)
  buf.writeDoubleLE(minY, 20)
  buf.writeDoubleLE(minZ, 28)
  buf.writeFloatLE(scaleFt, 36)
  let o = HEADER_BYTES
  for (let i = 0; i < xyzFt.length; i += 3) {
    const qx = Math.round((xyzFt[i] - minX) / scaleFt)
    const qy = Math.round((xyzFt[i + 1] - minY) / scaleFt)
    const qz = Math.round((xyzFt[i + 2] - minZ) / scaleFt)
    if (qx > 65535 || qy > 65535 || qz > 65535) {
      throw new Error(`Tile extent exceeds uint16 at ${scaleFt} ft resolution`)
    }
    buf.writeUInt16LE(qx, o)
    buf.writeUInt16LE(qy, o + 2)
    buf.writeUInt16LE(qz, o + 4)
    o += 6
  }
  return gzipSync(buf, { level: 9 })
}

export function decodeTilePoints(gz: Uint8Array): TilePoints {
  const buf = gunzipSync(gz)
  if (buf.toString('ascii', 0, 4) !== MAGIC) throw new Error('Not an ARXL lidar tile')
  const version = buf.readUInt8(4)
  if (version !== VERSION) throw new Error(`Unsupported ARXL version ${version}`)
  const count = buf.readUInt32LE(8)
  const ox = buf.readDoubleLE(12)
  const oy = buf.readDoubleLE(20)
  const oz = buf.readDoubleLE(28)
  const s = buf.readFloatLE(36)
  const xyz = new Float64Array(count * 3)
  let o = HEADER_BYTES
  for (let i = 0; i < count; i++) {
    xyz[i * 3] = ox + buf.readUInt16LE(o) * s
    xyz[i * 3 + 1] = oy + buf.readUInt16LE(o + 2) * s
    xyz[i * 3 + 2] = oz + buf.readUInt16LE(o + 4) * s
    o += 6
  }
  return { xyz }
}
