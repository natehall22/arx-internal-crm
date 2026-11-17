/** @jest-environment node */
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

import { getOrgBrandResult, ORG_BRAND_COLUMNS, resolveOrgBrand, usesOriginalCompanyAssets } from '@/lib/org-brand'

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === '.next' || f === '__tests__' || f === 'test-helpers') continue
    const p = path.join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}

describe('every org brand reader selects the original_brand marker', () => {
  it('ORG_BRAND_COLUMNS carries it', () => {
    expect(ORG_BRAND_COLUMNS).toContain('original_brand')
  })

  it('a file that calls resolveOrgBrand(<row>) reads the row with ORG_BRAND_COLUMNS', () => {
    const offenders: string[] = []
    for (const root of ['app', 'lib', 'components']) {
      for (const file of walk(path.join(process.cwd(), root))) {
        if (file.endsWith(path.join('lib', 'org-brand.ts'))) continue
        const src = readFileSync(file, 'utf8')
        const fromRow = /resolveOrgBrand\((?!null\b|\)|\{)/.test(src)
        if (fromRow && !src.includes('ORG_BRAND_COLUMNS')) offenders.push(path.relative(process.cwd(), file))
      }
    }
    expect(offenders).toEqual([])
  })

  it('a database without the column (42703): loud log, neutral brand, never the original company', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    const selects: string[] = []
    const client = {
      from: () => ({
        select: (cols: string) => {
          selects.push(cols)
          return {
            eq: () => ({
              maybeSingle: async () =>
                cols.includes('original_brand')
                  ? { data: null, error: { code: '42703', message: 'column orgs.original_brand does not exist' } }
                  : { data: { name: 'ARX Roofing & Exteriors', phone: null, email: null, address: null, brand: null }, error: null },
            }),
          }
        },
      }),
    }
    const r = await getOrgBrandResult(client as never, 'org-1')
    expect(selects).toHaveLength(2)
    expect(err.mock.calls.some((a) => String(a[0]).includes('original_brand'))).toBe(true)
    expect(usesOriginalCompanyAssets(r.brand)).toBe(false)
    expect(r.brand.phone).toBe('')
    expect(r.brand.name).toBe('ARX Roofing & Exteriors') // the row's own name column, nothing from the legacy fallback
    err.mockRestore()
    expect(resolveOrgBrand(null).original).toBeUndefined()
  })
})
