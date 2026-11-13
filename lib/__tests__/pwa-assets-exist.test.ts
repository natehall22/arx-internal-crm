/** Every icon/screenshot in a public manifest and every precache path in a public service worker must exist on disk,
 *  or the install icon is missing and `cache.addAll` rejects (the worker never installs). */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const PUBLIC = join(process.cwd(), 'public')
const files = readdirSync(PUBLIC)
const manifests = files.filter((f) => /manifest.*\.json$/.test(f))
const workers = files.filter((f) => /sw.*\.js$/.test(f))

const onDisk = (p: string) => existsSync(join(PUBLIC, p.split('?')[0].replace(/^\//, '')))

describe('public PWA assets', () => {
  it('finds manifests and service workers', () => {
    expect(manifests.length).toBeGreaterThan(0)
    expect(workers.length).toBeGreaterThan(0)
  })

  it.each(manifests)('%s: icons, screenshots and shortcut icons exist', (name) => {
    const m = JSON.parse(readFileSync(join(PUBLIC, name), 'utf8'))
    const srcs: string[] = [
      ...(m.icons ?? []).map((i: { src: string }) => i.src),
      ...(m.screenshots ?? []).map((i: { src: string }) => i.src),
      ...(m.shortcuts ?? []).flatMap((s: { icons?: { src: string }[] }) => (s.icons ?? []).map((i) => i.src)),
    ]
    expect(srcs.filter((s) => !onDisk(s))).toEqual([])
  })

  it.each(workers)('%s: precached files exist', (name) => {
    const src = readFileSync(join(PUBLIC, name), 'utf8')
    const arrays = Array.from(src.matchAll(/const\s+\w*(?:PRECACHE|STATIC)\w*\s*=\s*\[([\s\S]*?)\]/g))
    expect(arrays.length).toBeGreaterThan(0)
    const paths = arrays.flatMap((a) => Array.from(a[1].matchAll(/['"](\/[^'"]*)['"]/g)).map((m) => m[1]))
    // Page routes such as '/' and '/canvass' have no file extension; only real files are checked here.
    const files = paths.filter((p) => /\.[a-z0-9]+$/i.test(p))
    expect(files.length).toBeGreaterThan(0)
    expect(files.filter((p) => !onDisk(p))).toEqual([])
  })
})
