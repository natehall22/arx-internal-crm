/**
 * Move signed documents — reading a ZIP safely. Pure; runs in the browser (so a 500 MB export never goes through our
 * servers) and in tests. Library: fflate (MIT, no dependencies, already in the app's tree through the PDF tools; its
 * streaming `Unzip` is what lets us stop an entry mid-way).
 *
 * What a hostile or broken ZIP can and cannot do here:
 *  - ZIP bomb: sizes in the headers are IGNORED (they can lie). Every entry is counted as it unzips and stopped at
 *    `maxEntryBytes`; the bytes unzipped across all entries (including stopped ones) stop the whole read at
 *    `maxWorkBytes`; only PDFs and CSVs are ever unzipped (everything else is never started, so it costs nothing).
 *  - Path traversal: entry names are labels. A name with `..`, an absolute path, a drive letter or control characters is
 *    reported and skipped; nothing here writes to a path.
 *  - ZIP inside ZIP: not opened (skipped with a reason) — no recursion to bound.
 *  - Encrypted / damaged entries: reported as "couldn't be read", the rest carry on.
 *  - Never executed: bytes are only handed to `onEntry`.
 */
import { Unzip, UnzipInflate, UnzipPassThrough, type UnzipFile } from 'fflate'

import { DEFAULT_ZIP_LIMITS, dirOf, displayName, entryKind, isZipJunk, looksLikePdf, unsafeEntryReason, type EntryKind, type ZipLimits } from './files'

export type ZipEntry = { path: string; name: string; dir: string; kind: EntryKind; bytes: Uint8Array }
export type ZipSkip = { path: string; reason: string }
export type ZipSummary = { entries: number; kept: number; skipped: ZipSkip[]; aborted: string | null }

export class ZipLimitError extends Error {}

type Source = Uint8Array | AsyncIterable<Uint8Array> | Iterable<Uint8Array>

/**
 * Reads a File/Blob in small slices. The slice size is also the bomb bound: one push inflates synchronously, so at DEFLATE's
 * ~1000:1 ceiling a 64 KB slice yields at most ~64 MB before the work cap can stop it (a 2 MB slice allowed ~2 GB).
 */
export async function* blobChunks(blob: { size: number; slice: (a: number, b: number) => { arrayBuffer: () => Promise<ArrayBuffer> } }, chunk = 64 * 1024): AsyncGenerator<Uint8Array> {
  for (let at = 0; at < blob.size; at += chunk) yield new Uint8Array(await blob.slice(at, Math.min(blob.size, at + chunk)).arrayBuffer())
}

async function* asChunks(source: Source): AsyncGenerator<Uint8Array> {
  if (source instanceof Uint8Array) {
    for (let at = 0; at < source.length; at += 64 * 1024) yield source.subarray(at, Math.min(source.length, at + 64 * 1024))
    return
  }
  for await (const c of source as AsyncIterable<Uint8Array>) yield c
}

/**
 * Walks the ZIP once. `onEntry` is awaited between chunks, so a caller that uploads each file as it arrives keeps memory at
 * about one chunk plus the files of the current chunk. Never throws for a bad entry; throws `ZipLimitError` only for the
 * whole-ZIP limits (too many entries, too much work) after reporting what it had.
 */
export async function readZip(
  source: Source,
  onEntry: (e: ZipEntry) => void | Promise<void>,
  limits: Partial<ZipLimits> = {}
): Promise<ZipSummary> {
  const lim = { ...DEFAULT_ZIP_LIMITS, ...limits }
  const summary: ZipSummary = { entries: 0, kept: 0, skipped: [], aborted: null }
  const queue: ZipEntry[] = []
  let work = 0
  let keptBytes = 0
  let fatal: ZipLimitError | null = null
  const skip = (path: string, reason: string) => summary.skipped.push({ path: path.slice(0, 200), reason })

  const unzip = new Unzip()
  unzip.register(UnzipInflate)
  unzip.register(UnzipPassThrough)
  unzip.onfile = (file: UnzipFile) => {
    if (fatal) return
    const path = file.name
    if (isZipJunk(path)) return
    summary.entries += 1
    if (summary.entries > lim.maxEntries) {
      fatal = new ZipLimitError(`This ZIP has more than ${lim.maxEntries.toLocaleString()} files — split it`)
      return
    }
    const unsafe = unsafeEntryReason(path)
    if (unsafe) return skip(path, unsafe)
    const k = entryKind(path)
    if ('skip' in k) return skip(path, k.skip)
    const chunks: Uint8Array[] = []
    let size = 0
    let stopped = false
    file.ondata = (err, data, final) => {
      if (stopped) return
      if (err) {
        stopped = true
        return skip(path, 'couldn’t be read (damaged or password-protected)')
      }
      size += data.length
      work += data.length
      if (work > lim.maxWorkBytes) {
        stopped = true
        fatal = new ZipLimitError('This ZIP unpacks to far more than its size suggests — it was stopped. Add the files another way.')
        file.terminate()
        return
      }
      if (size > lim.maxEntryBytes) {
        stopped = true
        file.terminate()
        return skip(path, `over ${Math.round(lim.maxEntryBytes / 1024 / 1024)} MB once unpacked`)
      }
      chunks.push(data)
      if (final) {
        const bytes = chunks.length === 1 ? chunks[0] : concat(chunks, size)
        if (size === 0) return skip(path, 'empty')
        if (k.kind === 'pdf' && !looksLikePdf(bytes)) return skip(path, 'not really a PDF')
        keptBytes += size
        if (keptBytes > lim.maxKeptBytes) {
          fatal = new ZipLimitError('That is more than 2 GB of files in one ZIP — split it')
          return
        }
        queue.push({ path, name: displayName(path), dir: dirOf(path), kind: k.kind, bytes })
      }
    }
    try {
      file.start()
    } catch {
      skip(path, 'couldn’t be read (damaged or password-protected)')
    }
  }

  const drain = async () => {
    while (queue.length) {
      const e = queue.shift()!
      summary.kept += 1
      await onEntry(e)
    }
  }

  try {
    for await (const chunk of asChunks(source)) {
      try {
        unzip.push(chunk)
      } catch {
        // A damaged ZIP: keep what was read, say so.
        summary.aborted = 'The ZIP is damaged — files after the damage could not be read'
        break
      }
      await drain()
      if (fatal) break
    }
    if (!fatal && !summary.aborted) {
      try {
        unzip.push(new Uint8Array(0), true)
      } catch {
        summary.aborted = 'The ZIP ended early — files near the end may be missing'
      }
      await drain()
    }
  } finally {
    queue.length = 0
  }
  if (fatal) {
    summary.aborted = (fatal as ZipLimitError).message
  }
  return summary
}

function concat(parts: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
