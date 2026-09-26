/**
 * Decode a USGS LAZ tile and keep only building points (ASPRS class 6), in the
 * tile's native coordinates. Server/worker only — laz-perf is WebAssembly.
 */
import { createLazPerf } from 'laz-perf'

/** ASPRS LAS classification code for buildings (vendor-classified in 3DEP data). */
export const LAS_CLASS_BUILDING = 6

export async function buildingPointsFromLaz(laz: Uint8Array): Promise<{ total: number; xyz: Float64Array }> {
  const dv = new DataView(laz.buffer, laz.byteOffset, laz.byteLength)
  if (String.fromCharCode(laz[0], laz[1], laz[2], laz[3]) !== 'LASF') throw new Error('Not a LAS/LAZ file')
  const format = laz[104] & 0x3f
  const recordLength = dv.getUint16(105, true)
  const sx = dv.getFloat64(131, true), sy = dv.getFloat64(139, true), sz = dv.getFloat64(147, true)
  const ox = dv.getFloat64(155, true), oy = dv.getFloat64(163, true), oz = dv.getFloat64(171, true)
  // LAS 1.4 point formats 6–10 keep classification in its own byte; 0–5 pack it in 5 bits.
  const classOffset = format >= 6 ? 16 : 15
  const classMask = format >= 6 ? 0xff : 0x1f

  const mod = await createLazPerf()
  const filePtr = mod._malloc(laz.byteLength)
  const pointPtr = mod._malloc(recordLength)
  const reader = new mod.LASZip()
  try {
    mod.HEAPU8.set(laz, filePtr)
    reader.open(filePtr, laz.byteLength)
    const total = reader.getCount()
    const out: number[] = []
    for (let i = 0; i < total; i++) {
      reader.getPoint(pointPtr)
      const heap = mod.HEAPU8
      if ((heap[pointPtr + classOffset] & classMask) !== LAS_CLASS_BUILDING) continue
      const p = new DataView(heap.buffer, pointPtr, recordLength)
      out.push(p.getInt32(0, true) * sx + ox, p.getInt32(4, true) * sy + oy, p.getInt32(8, true) * sz + oz)
    }
    return { total, xyz: Float64Array.from(out) }
  } finally {
    reader.delete()
    mod._free(pointPtr)
    mod._free(filePtr)
  }
}
