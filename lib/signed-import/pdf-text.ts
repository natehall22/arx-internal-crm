/**
 * Move signed documents — the text of a PDF's first pages, for reading envelope ids, emails and dates out of a certificate
 * or an agreement. Server only. Library: unpdf (MIT; pdf.js built for servers, no canvas needed for text).
 *
 * The PDF is untrusted input and is only ever READ: text is pulled out, nothing is rendered, no script inside a PDF is
 * run (pdf.js has none enabled here; `isEvalSupported: false` keeps its font code path off `eval`). Limits: a page cap, a
 * size cap and a time cap; any failure returns null and the file is simply matched by name instead.
 */

export const TEXT_MAX_BYTES = 12 * 1024 * 1024
const TEXT_MAX_CHARS = 60_000

export async function extractPdfText(bytes: Uint8Array, opts: { maxPages?: number; timeoutMs?: number } = {}): Promise<string | null> {
  if (bytes.length === 0 || bytes.length > TEXT_MAX_BYTES) return null
  const maxPages = opts.maxPages ?? 4
  const timeoutMs = opts.timeoutMs ?? 8000
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const work = (async () => {
      const { getDocumentProxy } = await import('unpdf')
      // pdf.js takes ownership of the array it is given: hand it a copy.
      const pdf = await getDocumentProxy(new Uint8Array(bytes), { isEvalSupported: false } as never)
      try {
        let out = ''
        const pages = Math.min(pdf.numPages, maxPages)
        for (let n = 1; n <= pages && out.length < TEXT_MAX_CHARS; n++) {
          const page = await pdf.getPage(n)
          const content = await page.getTextContent()
          for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
            if (typeof item.str === 'string') out += item.str + (item.hasEOL ? '\n' : ' ')
          }
          out += '\n'
        }
        return out.slice(0, TEXT_MAX_CHARS)
      } finally {
        // Not every build of the proxy has destroy(); freeing it is best effort.
        await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.()?.catch?.(() => undefined)
      }
    })()
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs)
    })
    return await Promise.race([work, timeout])
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}
