/**
 * Server-only Static Maps fetch (Sharp). Do not import from client components.
 */
import sharp from 'sharp'
import { fetchStaticSatelliteMapBase64 } from '@/lib/static-satellite-map'

/** Normalize Static Maps JPEG/PNG to PNG base64 for consistent client decode. */
export async function fetchStaticSatelliteMapPngBase64(params: {
  lat: number
  lng: number
  zoom: number
  sizeW: number
  sizeH: number
}): Promise<string> {
  const rawBase64 = await fetchStaticSatelliteMapBase64(params)
  const pngBuffer = await sharp(Buffer.from(rawBase64, 'base64')).png().toBuffer()
  return pngBuffer.toString('base64')
}
