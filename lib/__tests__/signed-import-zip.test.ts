/** @jest-environment node */
/**
 * Move signed documents — reading a ZIP the owner downloaded from somewhere. A malicious or broken ZIP must be reported
 * and skipped, never trusted: bombs (headers that lie, huge expansion), path traversal names, ZIP inside ZIP, encrypted
 * or damaged entries, folders and system junk, non-PDFs wearing a .pdf name.
 */
import { zipSync, strToU8 } from 'fflate'

import { readZip, ZipLimitError, type ZipEntry } from '@/lib/signed-import/zip'
import { entryKind, isZipJunk, looksLikePdf, unsafeEntryReason } from '@/lib/signed-import/files'

const pdf = (text = 'x') => strToU8(`%PDF-1.4\n${text}\n%%EOF`)
async function read(zip: Uint8Array, limits = {}) {
  const entries: ZipEntry[] = []
  const summary = await readZip(zip, (e) => void entries.push(e), limits)
  return { entries, summary }
}

describe('readZip', () => {
  test('keeps PDFs and CSVs, with names and folders', async () => {
    const zip = zipSync({
      'Smith, Jane/Contract.pdf': pdf('a'),
      'Smith, Jane/Certificate.pdf': pdf('b'),
      'envelopes.csv': strToU8('Envelope Id,Status\n1,Completed\n'),
    })
    const { entries, summary } = await read(zip)
    expect(entries.map((e) => `${e.dir}|${e.name}|${e.kind}`).sort()).toEqual(['Smith, Jane|Certificate.pdf|pdf', 'Smith, Jane|Contract.pdf|pdf', '|envelopes.csv|csv'])
    expect(summary).toMatchObject({ kept: 3, aborted: null })
    expect(Buffer.from(entries.find((e) => e.name === 'Contract.pdf')!.bytes).toString()).toContain('%PDF-1.4')
  })

  test('path traversal and absolute names are reported and never kept', async () => {
    const zip = zipSync({
      '../../etc/evil.pdf': pdf(),
      '/abs/evil.pdf': pdf(),
      'C:\\Windows\\evil.pdf': pdf(),
      'ok/../../evil2.pdf': pdf(),
      'fine.pdf': pdf(),
    })
    const { entries, summary } = await read(zip)
    expect(entries.map((e) => e.path)).toEqual(['fine.pdf'])
    expect(summary.skipped.filter((s) => /unsafe/.test(s.reason))).toHaveLength(4)
  })

  test('a ZIP bomb: one PDF that unpacks past the limit is stopped, the rest still read', async () => {
    const bomb = new Uint8Array(40 * 1024 * 1024)
    bomb.set(strToU8('%PDF-1.4'))
    const zip = zipSync({ 'bomb.pdf': bomb, 'real.pdf': pdf() })
    expect(zip.length).toBeLessThan(200_000) // tiny on disk, 40 MB unpacked
    const { entries, summary } = await read(zip, { maxEntryBytes: 1024 * 1024 })
    expect(entries.map((e) => e.name)).toEqual(['real.pdf'])
    expect(summary.skipped).toEqual([expect.objectContaining({ path: 'bomb.pdf', reason: expect.stringMatching(/over/) })])
  })

  test('a ZIP whose headers LIE about the size is still stopped by the bytes actually unpacked', async () => {
    const big = new Uint8Array(8 * 1024 * 1024)
    big.set(strToU8('%PDF-1.4'))
    const zip = zipSync({ 'liar.pdf': big })
    // Rewrite the declared uncompressed size (local header at offset 22, central directory at +24 from its signature) to 10 bytes.
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    dv.setUint32(22, 10, true)
    for (let i = 0; i + 4 < zip.length; i++) if (dv.getUint32(i, true) === 0x02014b50) dv.setUint32(i + 24, 10, true)
    const { entries, summary } = await read(zip, { maxEntryBytes: 1024 * 1024 })
    expect(entries).toEqual([])
    expect(summary.skipped).toEqual([expect.objectContaining({ path: 'liar.pdf', reason: expect.stringMatching(/over 1 MB/) })])
  })

  test('many entries that each unpack a lot hit the work limit and stop the whole read', async () => {
    const chunk = new Uint8Array(2 * 1024 * 1024)
    chunk.set(strToU8('%PDF-1.4'))
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < 12; i++) files[`f${i}.pdf`] = chunk
    const { summary, entries } = await read(zipSync(files), { maxWorkBytes: 7 * 1024 * 1024, maxEntryBytes: 3 * 1024 * 1024 })
    expect(summary.aborted).toMatch(/unpacks to far more/)
    expect(entries.length).toBeLessThan(12)
  })

  test('too many entries stops the read', async () => {
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < 30; i++) files[`f${i}.pdf`] = pdf(String(i))
    const { summary } = await read(zipSync(files), { maxEntries: 10 })
    expect(summary.aborted).toMatch(/more than 10 files/)
  })

  test('a ZIP inside a ZIP, spreadsheets, images and executables are listed as skipped, never opened', async () => {
    const inner = zipSync({ 'inner.pdf': pdf() })
    const zip = zipSync({ 'nested.zip': inner, 'run.exe': strToU8('MZ'), 'photo.jpg': strToU8('jpg'), 'sheet.xlsx': strToU8('x'), 'a.pdf': pdf() })
    const { entries, summary } = await read(zip)
    expect(entries.map((e) => e.name)).toEqual(['a.pdf'])
    expect(summary.skipped.map((s) => s.path).sort()).toEqual(['nested.zip', 'photo.jpg', 'run.exe', 'sheet.xlsx'])
    expect(summary.skipped.find((s) => s.path === 'nested.zip')!.reason).toMatch(/ZIP inside a ZIP/)
  })

  test('a .pdf that is not a PDF is refused; junk files and folders are ignored silently', async () => {
    const zip = zipSync({ 'fake.pdf': strToU8('<script>alert(1)</script>'), '__MACOSX/._a.pdf': pdf(), '.DS_Store': strToU8('x'), 'dir/': new Uint8Array(0), 'a.pdf': pdf() })
    const { entries, summary } = await read(zip)
    expect(entries.map((e) => e.name)).toEqual(['a.pdf'])
    expect(summary.skipped).toEqual([expect.objectContaining({ path: 'fake.pdf', reason: 'not really a PDF' })])
  })

  test('a ZIP cut off half way keeps what came before the cut and never throws', async () => {
    // Incompressible bytes, so cutting the ZIP really removes part of the second file.
    const noise = (seed: number) => {
      const b = new Uint8Array(60_000)
      let x = seed
      for (let i = 0; i < b.length; i++) b[i] = (x = (x * 1103515245 + 12345) & 0x7fffffff) >> 16
      b.set(strToU8('%PDF-1.4'))
      return b
    }
    const zip = zipSync({ 'a.pdf': noise(1), 'b.pdf': noise(2) })
    const { entries } = await read(zip.subarray(0, Math.floor(zip.length * 0.55)))
    expect(entries.map((e) => e.name)).toEqual(['a.pdf'])
  })

  test('garbage that is not a ZIP at all does not throw', async () => {
    const { entries } = await read(strToU8('this is not a zip file at all'.repeat(100)))
    expect(entries).toEqual([])
  })

  test('chunked input (a File read in slices) gives the same answer, and onEntry is awaited between chunks', async () => {
    const zip = zipSync({ 'a.pdf': pdf('a'), 'b.pdf': pdf('b'), 'c.pdf': pdf('c') })
    async function* slices() {
      for (let i = 0; i < zip.length; i += 37) yield zip.subarray(i, i + 37)
    }
    const order: string[] = []
    await readZip(slices(), async (e) => {
      order.push(`start ${e.name}`)
      await new Promise((r) => setTimeout(r, 2))
      order.push(`end ${e.name}`)
    })
    expect(order).toEqual(['start a.pdf', 'end a.pdf', 'start b.pdf', 'end b.pdf', 'start c.pdf', 'end c.pdf'])
  })
})

describe('name rules', () => {
  test('unsafeEntryReason', () => {
    for (const bad of ['../a.pdf', 'a/../../b.pdf', '/etc/passwd', 'C:/x.pdf', 'c:\\x.pdf', '\\\\server\\share\\a.pdf', 'a\u0000.pdf', 'x'.repeat(600)]) expect(unsafeEntryReason(bad)).not.toBeNull()
    for (const ok of ['a.pdf', 'Smith, Jane/Contract (1).pdf', 'ünï/ç.pdf', 'dir\\a.pdf']) expect(unsafeEntryReason(ok)).toBeNull()
  })
  test('entryKind / isZipJunk / looksLikePdf', () => {
    expect(entryKind('A.PDF')).toEqual({ kind: 'pdf' })
    expect(entryKind('x.csv')).toEqual({ kind: 'csv' })
    expect(entryKind('x.docx')).toHaveProperty('skip')
    expect(isZipJunk('__MACOSX/a.pdf')).toBe(true)
    expect(isZipJunk('a/._b.pdf')).toBe(true)
    expect(isZipJunk('a/b.pdf')).toBe(false)
    expect(looksLikePdf(strToU8('%PDF-1.7'))).toBe(true)
    expect(looksLikePdf(strToU8('GIF89a'))).toBe(false)
  })
  test('ZipLimitError is exported for callers that want to tell the limits apart', () => {
    expect(new ZipLimitError('x')).toBeInstanceOf(Error)
  })
})
