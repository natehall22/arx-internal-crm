/**
 * Server-side elevation photo stitching.
 *
 * Resizes each photo to a uniform height then composites them
 * side-by-side into a single wide JPEG. The stitched image gives
 * the AI vision model continuous context across the full elevation
 * instead of isolated fragments.
 *
 * Future iOS note: when LiDAR depth maps are available alongside
 * photos, they can be passed here as an additional Sharp channel
 * to produce a depth-annotated composite.
 */

import sharp from 'sharp'

const STITCH_HEIGHT = 900       // px — tall enough for detail, not so large it balloons tokens
const STITCH_MAX_WIDTH = 4096   // px — GPT-4o high-detail limit
const OUTPUT_QUALITY = 82       // JPEG quality — good balance for OCR/detail at token cost

export type ImageBuffer = {
  buffer: Buffer
  mimeType: string
}

/**
 * Stitch one or more image buffers into a single horizontal panorama JPEG.
 * Returns a base64-encoded JPEG string ready to embed in a data URI.
 */
export async function stitchElevationPhotos(images: ImageBuffer[]): Promise<string> {
  if (images.length === 0) throw new Error('No images to stitch')

  // Single image — just normalise and return; no compositing needed
  if (images.length === 1) {
    const resized = await sharp(images[0].buffer)
      .resize({ height: STITCH_HEIGHT, withoutEnlargement: false })
      .jpeg({ quality: OUTPUT_QUALITY })
      .toBuffer()
    return resized.toString('base64')
  }

  // Resize every image to the target height, preserving aspect ratio
  const resized = await Promise.all(
    images.map(async (img) => {
      const buf = await sharp(img.buffer)
        .resize({ height: STITCH_HEIGHT, withoutEnlargement: false })
        .jpeg({ quality: OUTPUT_QUALITY })
        .toBuffer()
      const meta = await sharp(buf).metadata()
      return { buf, width: meta.width ?? STITCH_HEIGHT, height: meta.height ?? STITCH_HEIGHT }
    })
  )

  const totalWidth = resized.reduce((sum, r) => sum + r.width, 0)

  // If stitched width would exceed GPT-4o's useful limit, scale everything down proportionally
  const scale = totalWidth > STITCH_MAX_WIDTH ? STITCH_MAX_WIDTH / totalWidth : 1
  const finalHeight = Math.round(STITCH_HEIGHT * scale)

  const scaledPanels = await Promise.all(
    resized.map(async (r) => {
      const finalWidth = Math.round(r.width * scale)
      const buf = scale < 1
        ? await sharp(r.buf).resize({ width: finalWidth, height: finalHeight }).jpeg({ quality: OUTPUT_QUALITY }).toBuffer()
        : r.buf
      return { buf, width: Math.round(r.width * scale) }
    })
  )

  const canvasWidth = scaledPanels.reduce((sum, p) => sum + p.width, 0)

  // Build the composite: blank white canvas + each panel placed left-to-right
  let left = 0
  const composites: sharp.OverlayOptions[] = scaledPanels.map((panel) => {
    const overlay: sharp.OverlayOptions = { input: panel.buf, left, top: 0 }
    left += panel.width
    return overlay
  })

  const stitched = await sharp({
    create: {
      width: canvasWidth,
      height: finalHeight,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(composites)
    .jpeg({ quality: OUTPUT_QUALITY })
    .toBuffer()

  return stitched.toString('base64')
}
