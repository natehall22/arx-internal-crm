/**
 * Move from Jobber — which customer a downloaded file belongs to, from its name. Pure and client-safe.
 * Jobber has no bulk file export (help.getjobber.com "Files and media library": downloads are one client at a time), so
 * people save files as "Client Name - Contract.pdf" (or "Smith, Jane_agreement.pdf"). Each part of the name is tried
 * against the company's customers; nothing is attached until a person confirms the match screen.
 */
import { nameKey } from './values'

export type CustomerName = { id: string; name: string }
export type FileMatch = { fileName: string; customerId: string | null; how: 'exact' | 'close' | null; candidates: CustomerName[]; title: string }

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1)

/** "Jane Smith - Contract 2025.pdf" → parts ["Jane Smith", "Contract 2025"], title "Contract 2025". */
export function fileNameParts(fileName: string): { parts: string[]; title: string } {
  const stem = fileName.replace(/\.[a-z0-9]{1,5}$/i, '').trim()
  const parts = stem.split(/\s+[-–—]\s+|_+|\s*\|\s*/).map((p) => p.trim()).filter(Boolean)
  return { parts: parts.length ? parts : [stem], title: (parts.length > 1 ? parts.slice(1).join(' - ') : stem).slice(0, 200) }
}

export function matchFileNames(fileNames: string[], customers: CustomerName[]): FileMatch[] {
  const byKey = new Map<string, CustomerName[]>()
  for (const c of customers) {
    const keys = [nameKey(c.name)]
    // "Smith, Jane" ↔ "Jane Smith"
    const comma = c.name.split(',')
    if (comma.length === 2) keys.push(nameKey(`${comma[1]} ${comma[0]}`))
    const w = c.name.trim().split(/\s+/)
    if (w.length === 2) keys.push(nameKey(`${w[1]} ${w[0]}`))
    for (const k of keys) if (k) byKey.set(k, [...(byKey.get(k) ?? []), c])
  }
  return fileNames.map((fileName) => {
    const { parts, title } = fileNameParts(fileName)
    for (const part of parts) {
      const hit = byKey.get(nameKey(part))
      if (hit && hit.length === 1) return { fileName, customerId: hit[0].id, how: 'exact', candidates: hit, title: parts.length > 1 ? title : 'Document' }
      if (hit && hit.length > 1) return { fileName, customerId: null, how: null, candidates: hit.slice(0, 5), title }
    }
    // Close: most of a customer's name words appear in the file name.
    const fileWords = new Set(words(parts.join(' ')))
    const scored = customers
      .map((c) => {
        const cw = words(c.name)
        if (!cw.length) return { c, score: 0 }
        const hits = cw.filter((w) => fileWords.has(w)).length
        return { c, score: hits / cw.length - (cw.length === 1 ? 0.3 : 0) }
      })
      .filter((x) => x.score >= 0.6)
      .sort((a, b) => b.score - a.score)
    const top = scored[0]
    const clear = top && (!scored[1] || scored[1].score < top.score)
    return { fileName, customerId: clear ? top.c.id : null, how: clear ? 'close' : null, candidates: scored.slice(0, 5).map((x) => x.c), title }
  })
}
