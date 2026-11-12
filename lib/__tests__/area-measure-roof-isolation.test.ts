/** @jest-environment node */
/**
 * OWNER RULE (hard): the roof measuring tool must not change at all — `app/tools/roof-measure/`, `lib/lidar/*`,
 * `lib/roof-measure*`, the detect-roof API and the website instant estimate. The Measure yard tool is a separate tool.
 *
 * Guard 1 — "area measure tool never imports roof measure / lidar code": no file of the new tool imports (or re-exports,
 *           or dynamically imports, or requires) anything on a protected path.
 * Guard 2 — "area measure branch never touches roof measure / lidar paths": the branch's diff against its merge base
 *           with integration/multi-company changes no protected file (committed, uncommitted or untracked). Needs git;
 *           skipped when git or the base is missing. It only runs on the feat/area-measure branch (or with
 *           AREA_MEASURE_GUARD=1, base override AREA_MEASURE_BASE): after the branch merges, other people's legitimate roof
 *           work must not fail this test.
 */
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '..', '..')

/** Repo-relative (posix) paths that must never change: the roof measuring tool + lidar + detect-roof + instant estimate. */
export const PROTECTED_PATHS: readonly RegExp[] = [
  /^app\/tools\/roof-measure\//,
  /^lib\/lidar\//,
  /^lib\/lidar-/,
  /^lib\/roof-measure/,
  /^lib\/solar-roof-mask-facets/,
  /^app\/api\/ai\/detect-roof\//,
  /^app\/api\/maps\/usgs-lidar\//,
  /^app\/api\/cron\/lidar-ingest\//,
  /^app\/api\/(opportunities|ops\/jobs)\/\[id\]\/measure\/lidar\//,
  /^app\/api\/measurements\/solar-footprint\//,
  // The website instant roof estimate.
  /^lib\/public-roof-estimate/,
  /^lib\/public-estimate-/,
  /^lib\/instant-estimate-/,
  /^app\/api\/public\/estimate\//,
  /^app\/api\/cron\/instant-estimate-accuracy\//,
]

/** An import specifier that points at protected code (works for `@/lib/...` and relative paths alike). */
export const PROTECTED_IMPORT = /(roof-measure|\/lidar(\/|-|'|"|$)|lidar-measure|public-roof-estimate|public-estimate-|instant-estimate|detect-roof|solar-roof-mask|solar-footprint|usgs-lidar)/

export const isProtectedPath = (p: string): boolean => PROTECTED_PATHS.some((re) => re.test(p.replace(/\\/g, '/')))

/** Every module specifier a source file pulls in: `from '…'`, `import '…'`, `import('…')`, `require('…')`. */
export function importSpecifiers(source: string): string[] {
  const out: string[] = []
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"`])([^'"`\n]+)\1/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) out.push(m[2])
  return out
}

/** Files of the new tool (not their tests). */
function toolFiles(): string[] {
  const roots = ['app/tools/area-measure', 'components/area-measure', 'app/api/area-measure']
  const files: string[] = []
  const walk = (dir: string) => {
    const abs = path.join(ROOT, dir)
    if (!fs.existsSync(abs)) return
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) walk(rel)
      else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) files.push(rel)
    }
  }
  roots.forEach(walk)
  for (const f of fs.readdirSync(path.join(ROOT, 'lib'))) {
    if (/^area-measure.*\.(ts|tsx)$/.test(f) || f === 'google-maps-client.ts') files.push(`lib/${f}`)
  }
  return files
}

describe('area measure tool never imports roof measure / lidar code', () => {
  it('the detector itself recognises protected imports (so a scan that finds nothing cannot pass)', () => {
    for (const bad of [
      "import x from '@/lib/lidar/measure-near'",
      "import x from '@/lib/lidar-measure-ingest'",
      "import { y } from '@/lib/roof-measure-geometry'",
      "export * from '../../tools/roof-measure/page'",
      "const m = await import('@/lib/public-roof-estimate')",
      "const m = require('@/lib/instant-estimate-calibration')",
      "import '@/app/api/ai/detect-roof/route'",
    ]) {
      expect(importSpecifiers(bad).some((s) => PROTECTED_IMPORT.test(s))).toBe(true)
    }
    for (const ok of ["import x from '@/lib/area-measure'", "import { loadGoogleMaps } from '@/lib/google-maps-client'", "import Link from 'next/link'"]) {
      expect(importSpecifiers(ok).some((s) => PROTECTED_IMPORT.test(s))).toBe(false)
    }
  })

  it('finds the tool files (page, screen, card, routes, rules)', () => {
    const files = toolFiles()
    for (const must of ['app/tools/area-measure/page.tsx', 'components/area-measure/AreaMeasureClient.tsx', 'app/api/area-measure/route.ts', 'lib/area-measure.ts', 'lib/area-measure-db.ts', 'lib/google-maps-client.ts']) {
      expect(files).toContain(must)
    }
  })

  it('no file of the tool imports a protected path', () => {
    const offenders: string[] = []
    for (const f of toolFiles()) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
      for (const spec of importSpecifiers(src)) if (PROTECTED_IMPORT.test(spec)) offenders.push(`${f} imports ${spec}`)
    }
    expect(offenders).toEqual([])
  })
})

function git(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 20_000 })
  return { ok: r.status === 0 && !r.error, out: (r.stdout ?? '').trim() }
}

describe('area measure branch never touches roof measure / lidar paths', () => {
  it('the path list covers the roof tool, lidar, detect-roof and the instant estimate', () => {
    for (const p of [
      'app/tools/roof-measure/page.tsx',
      'lib/lidar/roof-planes.ts',
      'lib/roof-measure-geometry.ts',
      'app/api/ai/detect-roof/route.ts',
      'lib/public-roof-estimate.ts',
      'lib/instant-estimate-accuracy.ts',
      'app/api/public/estimate/preview/route.ts',
    ]) {
      expect([p, isProtectedPath(p)]).toEqual([p, true])
    }
    for (const p of ['lib/area-measure.ts', 'app/tools/area-measure/page.tsx', 'lib/org-features.ts', 'lib/properties.ts']) expect([p, isProtectedPath(p)]).toEqual([p, false])
  })

  it('this branch\'s diff against its merge base changes none of them', () => {
    const inRepo = git(['rev-parse', '--is-inside-work-tree'])
    if (!inRepo.ok) return console.warn('area-measure guard: git is not available here — diff check skipped')
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out
    if (branch !== 'feat/area-measure' && process.env.AREA_MEASURE_GUARD !== '1') return console.warn(`area-measure guard: on "${branch}", not feat/area-measure — diff check skipped`)
    const candidates = [process.env.AREA_MEASURE_BASE, 'integration/multi-company', 'origin/integration/multi-company'].filter((c): c is string => !!c)
    let base: string | null = null
    for (const c of candidates) {
      const mb = git(['merge-base', 'HEAD', c])
      if (mb.ok && mb.out) {
        base = mb.out
        break
      }
    }
    if (!base) return console.warn('area-measure guard: no merge base found (integration/multi-company missing) — diff check skipped')
    const changed = new Set<string>()
    // Committed AND uncommitted changes to tracked files (base -> working tree), plus files not yet added.
    for (const f of git(['diff', '--name-only', '--no-renames', base]).out.split('\n')) if (f) changed.add(f)
    for (const f of git(['ls-files', '--others', '--exclude-standard']).out.split('\n')) if (f) changed.add(f)
    // A rename shows as delete + add with --no-renames, so the old protected path is reported too.
    expect(Array.from(changed).filter(isProtectedPath)).toEqual([])
  })
})
