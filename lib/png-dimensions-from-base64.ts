/**
 * Read width/height from a PNG IHDR without decoding the full image.
 * Google Static Maps typically returns PNG; if parsing fails, callers fall back to assumed size.
 */
export function getPngDimensionsFromBase64(base64: string): { width: number; height: number } | null {
  try {
    const stripped = base64.replace(/^data:image\/png;base64,/i, '').replace(/^data:image\/\w+;base64,/, '')
    const buf = Buffer.from(stripped, 'base64')
    if (buf.length < 24) return null
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null
    if (buf.readUInt32BE(8) !== 13) return null
    const type = buf.subarray(12, 16).toString('ascii')
    if (type !== 'IHDR') return null
    const width = buf.readUInt32BE(16)
    const height = buf.readUInt32BE(20)
    if (width > 0 && width <= 8192 && height > 0 && height <= 8192) {
      return { width, height }
    }
    return null
  } catch {
    return null
  }
}
