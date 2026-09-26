import sharp from 'sharp'
import { registerOutlinesToImage } from '@/lib/lidar/image-register'

/** A dark roof rectangle on a light yard, drawn `shift` metres from where the outline says. */
async function photo(shift: { east: number; north: number }, mpp: number) {
  const W = 640
  const cx = W / 2 + shift.east / mpp
  const cy = W / 2 - shift.north / mpp
  const w = 12 / mpp, h = 8 / mpp
  const svg = `<svg width="${W}" height="${W}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#8aa06a"/><rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" fill="#3a3a44"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}
const outline = [[{ x: -6, y: -4 }, { x: 6, y: -4 }, { x: 6, y: 4 }, { x: -6, y: 4 }]]

describe('registerOutlinesToImage', () => {
  it('finds a 1 m west / 1 m north photo offset', async () => {
    const mpp = 0.06
    const r = await registerOutlinesToImage({ outlines: outline, image: await photo({ east: -1, north: 1 }, mpp), metersPerPixel: mpp })
    expect(r.confident).toBe(true)
    expect(r.eastM).toBeCloseTo(-1, 0)
    expect(r.northM).toBeCloseTo(1, 0)
  })

  it('leaves an already-aligned outline in place', async () => {
    const mpp = 0.06
    const r = await registerOutlinesToImage({ outlines: outline, image: await photo({ east: 0, north: 0 }, mpp), metersPerPixel: mpp })
    expect(Math.abs(r.eastM)).toBeLessThan(0.2)
    expect(Math.abs(r.northM)).toBeLessThan(0.2)
  })

  it('does not move when the photo has nothing to match (no roof visible)', async () => {
    const blank = await sharp({ create: { width: 640, height: 640, channels: 3, background: '#8aa06a' } }).png().toBuffer()
    const r = await registerOutlinesToImage({ outlines: outline, image: blank, metersPerPixel: 0.06 })
    expect(r.confident).toBe(false)
    expect(r.eastM).toBe(0)
    expect(r.northM).toBe(0)
  })
})
