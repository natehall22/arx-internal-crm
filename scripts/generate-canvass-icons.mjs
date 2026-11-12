#!/usr/bin/env node
// Builds the canvass install icons (PNG) from public/canvass-icons/icon-192.svg. Re-run only if the SVG changes.
//   node scripts/generate-canvass-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const dir = 'public/canvass-icons'
const svg = readFileSync(`${dir}/icon-192.svg`, 'utf8')

// "any" icons: the SVG as drawn (rounded square).
for (const size of [192, 512]) {
  const png = await sharp(Buffer.from(svg), { density: (72 * size) / 192 }).resize(size, size).png().toBuffer()
  writeFileSync(`${dir}/icon-${size}.png`, png)
}

// Maskable icon: Android crops to a circle/squircle, so the background must be full-bleed. The pin already sits inside
// the central 60% (about 20% padding each side), so it is the same glyph on a square with no rounded corners.
const maskable = svg.replace(/ rx="40"/, '')
const png = await sharp(Buffer.from(maskable), { density: (72 * 512) / 192 }).resize(512, 512).png().toBuffer()
writeFileSync(`${dir}/icon-maskable-512.png`, png)
