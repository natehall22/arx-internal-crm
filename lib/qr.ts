/**
 * A small QR code encoder (pure, client-safe): byte mode, error correction level M, versions 1–10 (up to 213 bytes — a pay
 * link is ~90). Returns the dark/light grid; `QrCode` (components/ui/QrCode.tsx) draws it as an SVG. Written here instead of
 * adding a dependency: it is the only QR use in the app. Follows ISO/IEC 18004 (same method as the public-domain Nayuki
 * reference); lib/__tests__/qr.test.ts checks the algebra and the structure, and the output was decoded with OpenCV.
 */

// Per version (1..10), level M: [ec codewords per block, [[blocks, data codewords per block], …]]
const BLOCKS_M: Array<[number, Array<[number, number]>]> = [
  [10, [[1, 16]]],
  [16, [[1, 28]]],
  [26, [[1, 44]]],
  [18, [[2, 32]]],
  [24, [[2, 43]]],
  [16, [[4, 27]]],
  [18, [[4, 31]]],
  [22, [[2, 38], [2, 39]]],
  [22, [[3, 36], [2, 37]]],
  [26, [[4, 43], [1, 44]]],
]
const ALIGN: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]
const VERSION_BITS: Record<number, number> = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 }

export const QR_MAX_BYTES = 213

function dataCodewords(version: number): number {
  return BLOCKS_M[version - 1][1].reduce((s, [n, d]) => s + n * d, 0)
}

// ---- Reed–Solomon over GF(256), polynomial 0x11D ----------------------------------------------------------------------
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
})()
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

export function reedSolomon(data: number[], ecLen: number): number[] {
  // generator = ∏ (x − α^i), i = 0..ecLen-1
  let gen = [1]
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(gen.length + 1).fill(0)
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j]
      next[j + 1] ^= mul(gen[j], EXP[i])
    }
    gen = next
  }
  const rem = new Array(ecLen).fill(0)
  for (const d of data) {
    const factor = d ^ rem[0]
    rem.shift()
    rem.push(0)
    for (let i = 0; i < ecLen; i++) rem[i] ^= mul(gen[i + 1], factor)
  }
  return rem
}

function bchFormat(bits5: number): number {
  let rem = bits5
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((bits5 << 10) | rem) ^ 0x5412
}

/** The data bits: mode 0100, 8-bit length (v1–9) / 16-bit (v10), bytes, terminator, padding. */
function dataBits(bytes: number[], version: number): number[] {
  const bits: number[] = []
  const push = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1)
  }
  push(0b0100, 4)
  push(bytes.length, version <= 9 ? 8 : 16)
  for (const b of bytes) push(b, 8)
  const cap = dataCodewords(version) * 8
  push(0, Math.min(4, cap - bits.length))
  while (bits.length % 8) bits.push(0)
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8)
  return bits
}

function interleave(codewords: number[], version: number): number[] {
  const [ecLen, groups] = BLOCKS_M[version - 1]
  const dataBlocks: number[][] = []
  let at = 0
  for (const [count, size] of groups) for (let i = 0; i < count; i++) (dataBlocks.push(codewords.slice(at, at + size)), (at += size))
  const ecBlocks = dataBlocks.map((b) => reedSolomon(b, ecLen))
  const out: number[] = []
  const maxData = Math.max(...dataBlocks.map((b) => b.length))
  for (let i = 0; i < maxData; i++) for (const b of dataBlocks) if (i < b.length) out.push(b[i])
  for (let i = 0; i < ecLen; i++) for (const b of ecBlocks) out.push(b[i])
  return out
}

type Grid = { size: number; dark: boolean[][]; fn: boolean[][] }

function emptyGrid(version: number): Grid {
  const size = version * 4 + 17
  const g: Grid = { size, dark: Array.from({ length: size }, () => new Array(size).fill(false)), fn: Array.from({ length: size }, () => new Array(size).fill(false)) }
  const set = (x: number, y: number, v: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    g.dark[y][x] = v
    g.fn[y][x] = true
  }
  // timing
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  // finders + separators
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy))
      set(cx + dx, cy + dy, d !== 2 && d !== 4)
    }
  }
  // alignment
  const pos = ALIGN[version - 1]
  for (const cy of pos) for (const cx of pos) {
    if ((cx === 6 && cy === 6) || (cx === 6 && cy === pos[pos.length - 1]) || (cx === pos[pos.length - 1] && cy === 6)) continue
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }
  // reserve format + version areas (drawn after the mask is chosen)
  for (let i = 0; i < 9; i++) {
    g.fn[8][i] = true
    g.fn[i][8] = true
  }
  for (let i = 0; i < 8; i++) {
    g.fn[8][size - 1 - i] = true
    g.fn[size - 1 - i][8] = true
  }
  g.dark[size - 8][8] = true // the always-dark module
  g.fn[size - 8][8] = true
  if (version >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
    g.fn[i][size - 11 + j] = true
    g.fn[size - 11 + j][i] = true
  }
  return g
}

function place(g: Grid, bits: number[]): void {
  let i = 0
  for (let right = g.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let v = 0; v < g.size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j
      const up = ((right + 1) & 2) === 0
      const y = up ? g.size - 1 - v : v
      if (!g.fn[y][x] && i < bits.length) g.dark[y][x] = bits[i++] === 1
    }
  }
}

const MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

function drawFormat(dark: boolean[][], size: number, mask: number, version: number): void {
  const bits = bchFormat((0b00 << 3) | mask) // level M = 00
  const bit = (i: number) => ((bits >>> i) & 1) === 1
  for (let i = 0; i <= 5; i++) dark[i][8] = bit(i)
  dark[7][8] = bit(6)
  dark[8][8] = bit(7)
  dark[8][7] = bit(8)
  for (let i = 9; i < 15; i++) dark[8][14 - i] = bit(i)
  for (let i = 0; i < 8; i++) dark[8][size - 1 - i] = bit(i)
  for (let i = 8; i < 15; i++) dark[size - 15 + i][8] = bit(i)
  dark[size - 8][8] = true
  if (version >= 7) {
    const v = VERSION_BITS[version]
    for (let i = 0; i < 18; i++) {
      const b = ((v >>> i) & 1) === 1
      const a = size - 11 + (i % 3)
      const c = Math.floor(i / 3)
      dark[c][a] = b
      dark[a][c] = b
    }
  }
}

function penalty(dark: boolean[][], size: number): number {
  let score = 0
  const runs = (line: boolean[]) => {
    let s = 0
    let run = 1
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) run++
      else {
        if (run >= 5) s += 3 + (run - 5)
        run = 1
      }
    }
    // finder-like 1:1:3:1:1 with 4 light on a side
    const pat = [true, false, true, true, true, false, true]
    for (let i = 0; i + 7 <= line.length; i++) {
      if (pat.every((p, k) => line[i + k] === p)) {
        const before = i >= 4 && [1, 2, 3, 4].every((k) => !line[i - k])
        const after = i + 7 + 4 <= line.length && [0, 1, 2, 3].every((k) => !line[i + 7 + k])
        if (before || after) s += 40
      }
    }
    return s
  }
  for (let y = 0; y < size; y++) score += runs(dark[y])
  for (let x = 0; x < size; x++) score += runs(dark.map((row) => row[x]))
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = dark[y][x]
    if (c === dark[y][x + 1] && c === dark[y + 1][x] && c === dark[y + 1][x + 1]) score += 3
  }
  let on = 0
  for (const row of dark) for (const c of row) if (c) on++
  score += Math.floor(Math.abs((on * 20) / (size * size) - 10)) * 10
  return score
}

/** The QR grid for a text (UTF-8), or null when it does not fit (over 213 bytes). `true` = dark. */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = Array.from(unescape(encodeURIComponent(text)), (c) => c.charCodeAt(0)) // UTF-8 bytes (no TextEncoder in every test env)
  let version = 0
  for (let v = 1; v <= 10; v++) {
    const overhead = 4 + (v <= 9 ? 8 : 16)
    if (overhead + bytes.length * 8 <= dataCodewords(v) * 8) {
      version = v
      break
    }
  }
  if (!version) return null
  const codewords: number[] = []
  const bits = dataBits(bytes, version)
  for (let i = 0; i < bits.length; i += 8) codewords.push(parseInt(bits.slice(i, i + 8).join(''), 2))
  const stream = interleave(codewords, version)
  const bitStream: number[] = []
  for (const cw of stream) for (let i = 7; i >= 0; i--) bitStream.push((cw >>> i) & 1)
  const grid = emptyGrid(version)
  place(grid, bitStream)
  let best: boolean[][] | null = null
  let bestScore = Infinity
  for (let m = 0; m < 8; m++) {
    const dark = grid.dark.map((row, y) => row.map((c, x) => (grid.fn[y][x] ? c : c !== MASKS[m](x, y))))
    drawFormat(dark, grid.size, m, version)
    const s = penalty(dark, grid.size)
    if (s < bestScore) {
      bestScore = s
      best = dark
    }
  }
  return best
}
