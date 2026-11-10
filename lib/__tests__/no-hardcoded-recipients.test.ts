/** @jest-environment node */
/**
 * Guard: no email is ever sent to a hardcoded address. Every recipient comes from the record's own company
 * (lib/company-recipient.ts) or its users. One exception, deliberately: trial-signup is a prospect of the CRM product
 * with no company yet, so it goes to the product owner's inbox.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const ALLOWED = new Set(['app/api/trial-signup/route.ts'])
const RECIPIENT_LITERAL = /\b(to|cc|bcc|replyTo)\s*:\s*['"`][^'"`$]*@[a-z0-9-]+\.[a-z.]+['"`]/i
const ENV_DEFAULT_RECIPIENT = /EMAIL_TO\s*\|\|\s*['"`][^'"`]*@/

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__' || e.name === 'test-helpers' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

test('no hardcoded to/cc/bcc/replyTo email address in app or lib', () => {
  const hits: string[] = []
  for (const dir of ['app', 'lib', 'components']) {
    for (const file of walk(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/')
      if (ALLOWED.has(rel)) continue
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (RECIPIENT_LITERAL.test(line) || ENV_DEFAULT_RECIPIENT.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`)
      })
    }
  }
  expect(hits).toEqual([])
})
