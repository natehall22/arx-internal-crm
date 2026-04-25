function stripDataUrl(base64: string): string {
  return base64.replace(/^data:image\/\w+;base64,/i, '')
}

/**
 * Read width/height from a PNG IHDR without decoding the full image.
 */
export function getPngDimensionsFromBase64(base64: string): { width: number; height: number } | null {
  try {
    const buf = Buffer.from(stripDataUrl(base64), 'base64')
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

/** SOF0 / SOF2 in JPEG — Static Maps may return JPEG in some cases. */
export function getJpegDimensionsFromBase64(base64: string): { width: number; height: number } | null {
  try {
    const buf = Buffer.from(stripDataUrl(base64), 'base64')
    if (buf.length < 10 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++
        continue
      }
      const marker = buf[i + 1]
      if (marker === 0xd9 || marker === 0xda) break
      const segLen = buf.readUInt16BE(i + 2)
      if (segLen < 2 || i + 2 + segLen > buf.length) break
      if (marker === 0xc0 || marker === 0xc2) {
        const height = buf.readUInt16BE(i + 5)
        const width = buf.readUInt16BE(i + 7)
        if (width > 0 && width <= 8192 && height > 0 && height <= 8192) return { width, height }
        return null
      }
      i += 2 + segLen
    }
    return null
  } catch {
    return null
  }
}

export function getBitmapDimensionsFromBase64(base64: string): { width: number; height: number } | null {
  return getPngDimensionsFromBase64(base64) ?? getJpegDimensionsFromBase64(base64)
}
