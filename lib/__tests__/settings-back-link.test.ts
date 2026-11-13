import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

import { SETTINGS_GROUPS } from '@/lib/settings-registry'

const root = join(__dirname, '..', '..')

// Registry entries that are not a separate Settings sub-page: anchors on the hub, tools elsewhere, and the personal /settings page.
const NOT_SETTINGS_SUBPAGES = new Set(['/canvass?areas=1', '/tools/roof-measure', '/settings'])

// Pages whose body lives in a layout or client component next to page.tsx.
const hrefs = SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => i.href)).filter((h) => !h.includes('#') && !NOT_SETTINGS_SUBPAGES.has(h))

function filesFor(href: string): string[] {
  const dir = join(root, 'app', href)
  const names = ['page.tsx', 'layout.tsx']
  const out = names.map((n) => join(dir, n)).filter(existsSync)
  // client components imported from the page folder
  const extra = existsSync(dir) ? readdirSync(dir).filter((f: string) => /Client\.tsx$/.test(f) && !out.includes(join(dir, f))).map((f: string) => join(dir, f)) : []
  // a parent layout (e.g. the Sisu hub) can carry the link for every page under it
  const parent = join(dir, '..', 'layout.tsx')
  return [...out, ...extra, ...(existsSync(parent) && !/\/app\/admin\/layout\.tsx$/.test(parent) ? [parent] : [])]
}

describe('Settings sub-pages share one back link', () => {
  it('finds the registry pages', () => {
    expect(hrefs.length).toBeGreaterThan(25)
  })

  it.each(hrefs)('%s renders SettingsBackLink', (href) => {
    const files = filesFor(href)
    expect(files.length).toBeGreaterThan(0)
    const uses = files.some((f) => /<SettingsBackLink\b/.test(readFileSync(f, 'utf8')))
    expect(uses).toBe(true)
  })

  it('no settings page keeps its own hand-rolled link back to /admin', () => {
    for (const href of hrefs) {
      for (const f of filesFor(href)) {
        expect(readFileSync(f, 'utf8')).not.toMatch(/<Link\s+href="\/admin"/)
      }
    }
  })
})
