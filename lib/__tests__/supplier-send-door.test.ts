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
    // The audit wrapper is the send route's own door: it calls sendOrderToSupplier and is imported only by that route.
    expect(users).toEqual(['app/api/ops/jobs/[id]/supplier-orders/send/route.ts', 'lib/suppliers/abc/audited-transmit.ts'])
    const wrappers = [...walk(join(root, 'app')), ...walk(join(root, 'lib')), ...walk(join(root, 'components'))]
      .filter((f) => !f.endsWith('audited-transmit.ts'))
      .filter((f) => readFileSync(f, 'utf8').includes('makeAuditedTransmit'))
      .map((f) => f.slice(root.length + 1))
    expect(wrappers).toEqual(['app/api/ops/jobs/[id]/supplier-orders/send/route.ts'])
  })

  it('the ABC submit call is reachable only through the connector', () => {
    const root = process.cwd()
    const users = [...walk(join(root, 'app')), ...walk(join(root, 'lib')), ...walk(join(root, 'components'))]
      .filter((f) => !f.endsWith('lib/suppliers/abc/client.ts'))
      .filter((f) => readFileSync(f, 'utf8').includes('submitAbcOrder'))
      .map((f) => f.slice(root.length + 1))
    expect(users).toEqual(['lib/suppliers/abc/connector.ts'])
  })
})
