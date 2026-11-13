import { qrMatrix, reedSolomon, QR_MAX_BYTES } from '@/lib/qr'

describe('qr encoder', () => {
  it('Reed-Solomon matches the ISO 18004 worked example (HELLO WORLD v1-M data → 10 check bytes)', () => {
    // From the standard's 1-M example "01234567" is for L; this is the widely published HELLO WORLD / 1-M vector.
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]
    expect(reedSolomon(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23])
  })

  it('picks the smallest version and keeps the finder patterns', () => {
    const m = qrMatrix('https://a.example/pay/abc')!
    expect(m.length).toBe(25) // version 2
    // top-left finder: 7x7 ring + 3x3 centre
    expect(m[0].slice(0, 7).every(Boolean)).toBe(true)
    expect(m[3][3]).toBe(true)
    expect(m[1][1]).toBe(false)
    // the always-dark module
    expect(m[m.length - 8][8]).toBe(true)
  })

  it('grows with the text and refuses what does not fit', () => {
    expect(qrMatrix('x'.repeat(100))!.length).toBe(41) // version 6
    expect(qrMatrix('x'.repeat(QR_MAX_BYTES))!.length).toBe(57) // version 10
    expect(qrMatrix('x'.repeat(QR_MAX_BYTES + 1))).toBeNull()
  })

  it('is deterministic', () => {
    expect(qrMatrix('https://a.example/pay/abc')).toEqual(qrMatrix('https://a.example/pay/abc'))
  })
})
