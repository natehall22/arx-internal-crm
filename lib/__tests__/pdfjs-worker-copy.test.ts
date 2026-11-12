/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// public/pdfjs/pdf.worker.min.mjs is a copy of the package's worker (webpack cannot bundle it). Upgrading pdfjs-dist must refresh it.
it('the served pdf.js worker is the installed package version', () => {
  const root = process.cwd()
  const served = readFileSync(join(root, 'public/pdfjs/pdf.worker.min.mjs'))
  const pkg = readFileSync(join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'))
  expect(served.equals(pkg)).toBe(true)
})
