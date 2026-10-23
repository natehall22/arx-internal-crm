import fs from 'fs'
import path from 'path'

import { parseOrderQuantity } from '@/lib/suppliers/abc/quantity'
import { STANDARD_LINES } from '@/lib/suppliers/abc/standard-lines'

describe('ABC item map screen', () => {
  it('lists every line key the order-list generator can produce', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/materials-order-list.ts'), 'utf8')
    const generated = Array.from(new Set(Array.from(src.matchAll(/^\s*key: '([a-z_]+)'/gm)).map((m) => m[1])))
    expect(generated.length).toBeGreaterThan(8)
    expect(STANDARD_LINES.map((l) => l.key).sort()).toEqual(generated.sort())
  })

  it('"1 bundle" and "3 bundles" are the same word; other words still do not match', () => {
    expect(parseOrderQuantity('1 bundle', 'bundles')).toBe(1)
    expect(parseOrderQuantity('3 bundles', 'bundle')).toBe(3)
    expect(parseOrderQuantity('3 rolls', 'bundles')).toBeNull()
  })

  it('each example quantity reads (or honestly does not) as the screen claims', () => {
    for (const l of STANDARD_LINES) {
      const reads = parseOrderQuantity(l.exampleQty, l.qtyUnitWord)
      if (l.caveat) expect(reads).toBeNull() // lines we warn about really are unreadable
      else expect(reads).not.toBeNull()
    }
  })
})
