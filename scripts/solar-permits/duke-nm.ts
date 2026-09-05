import { spawnSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { USER_AGENT } from './arcgis'
import { countyForMetroCity } from './metro-cities'

export const DUKE_DEC_PDF_URL =
  'http://ncrets.org/wp-content/uploads/sites/7/2026/08/DEC-NC-Non-TOUD-NM-Demand-07-2026.pdf'
export const DUKE_DEP_PDF_URL =
  'http://ncrets.org/wp-content/uploads/sites/7/2026/08/DEP-NC-Non-TOUD-NM-Demand-07-2026.pdf'

// Numbered groups, not named ones: named capture groups need an ES2018+ target,
// but this repo's shared tsconfig targets es5.
const LAYOUT_LINE = /^(.+?)\s{2,}([A-Za-z][A-Za-z .'`-]{1,40}?)\s{2,}NC\s+([\d.]+)\s*$/

export type DukeNmRow = {
  utility: 'DEC' | 'DEP'
  accountName: string
  city: string
  kwDc: number
  county: string | null
}

export function parseDukeNmLayoutLine(line: string, utility: 'DEC' | 'DEP'): DukeNmRow | null {
  const match = LAYOUT_LINE.exec(line.trimEnd())
  if (!match) return null
  const accountName = match[1].trim()
  const city = match[2].trim()
  const kwDc = Number(match[3])
  if (!accountName || !city || !Number.isFinite(kwDc)) return null
  if (/^(Customer Account Name|Record Count|Final Capacity)/i.test(accountName)) return null
  return {
    utility,
    accountName,
    city,
    kwDc,
    county: countyForMetroCity(city),
  }
}

export function parseDukeNmLayoutText(text: string, utility: 'DEC' | 'DEP'): DukeNmRow[] {
  const rows: DukeNmRow[] = []
  for (const line of text.split(/\r?\n/)) {
    const row = parseDukeNmLayoutLine(line, utility)
    if (row) rows.push(row)
  }
  return rows
}

export async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`Download failed HTTP ${res.status} for ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const { writeFile } = await import('node:fs/promises')
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, buf)
}

export function pdftotextLayout(pdfPath: string): string {
  const result = spawnSync('pdftotext', ['-layout', pdfPath, '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) {
    throw new Error(`pdftotext missing or failed: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`pdftotext exit ${result.status}: ${result.stderr}`)
  }
  return result.stdout
}

export async function loadDukeNmRows(dataDir: string, options?: { download?: boolean }): Promise<DukeNmRow[]> {
  const { access } = await import('node:fs/promises')
  const files: Array<{ utility: 'DEC' | 'DEP'; url: string; name: string }> = [
    { utility: 'DEC', url: DUKE_DEC_PDF_URL, name: 'duke-dec-nm-2026-07.pdf' },
    { utility: 'DEP', url: DUKE_DEP_PDF_URL, name: 'duke-dep-nm-2026-07.pdf' },
  ]
  const rows: DukeNmRow[] = []
  for (const file of files) {
    const dest = path.join(dataDir, file.name)
    let exists = false
    try {
      await access(dest)
      exists = true
    } catch {
      exists = false
    }
    if (!exists) {
      if (options?.download === false) {
        throw new Error(`Missing ${dest} (pass download or run census without --offline)`)
      }
      await downloadFile(file.url, dest)
    }
    rows.push(...parseDukeNmLayoutText(pdftotextLayout(dest), file.utility))
  }
  return rows
}
