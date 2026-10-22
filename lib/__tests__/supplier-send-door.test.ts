import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '__tests__') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

describe('supplier orders are never sent by anything automatic', () => {
  it('only the send route imports sendOrderToSupplier', () => {
    const root = process.cwd()
    const users = [...walk(join(root, 'app')), ...walk(join(root, 'lib')), ...walk(join(root, 'components'))]
      .filter((f) => !f.endsWith('lib/suppliers/send-order.ts'))
      .filter((f) => readFileSync(f, 'utf8').includes('sendOrderToSupplier'))
      .map((f) => f.slice(root.length + 1))
    expect(users).toEqual(['app/api/ops/jobs/[id]/supplier-orders/send/route.ts'])
  })
})
