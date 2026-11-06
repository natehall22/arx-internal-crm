/**
 * work_orders has TWO foreign keys to sub_contractors (assigned_sub_id, completed_by_sub_id), so an unhinted
 * `sub_contractors(...)` embed on a work_orders select is ambiguous and PostgREST answers PGRST201 — the whole read
 * fails. GC simulation 2026-11-06: lib/data-health.ts did this, which broke Needs-you and job catch-up for every job.
 */
import fs from 'fs'
import path from 'path'

const ROOTS = ['app', 'lib', 'components']

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : files(p)
    return /\.(ts|tsx)$/.test(e.name) ? [p] : []
  })
}

describe('work_orders → sub_contractors embeds', () => {
  it('always name the foreign key', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of files(path.join(process.cwd(), root))) {
        const src = fs.readFileSync(file, 'utf8')
        const re = /\.from\(\s*'work_orders'\s*\)\s*\.select\(\s*(`[^`]*`|'[^']*')/g
        for (const m of Array.from(src.matchAll(re))) {
          if (/sub_contractors\s*\(/.test(m[1])) offenders.push(path.relative(process.cwd(), file))
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
