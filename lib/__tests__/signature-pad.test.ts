/** @jest-environment node */
import fs from 'fs'
import path from 'path'

describe('signature pad', () => {
  const root = path.resolve(__dirname, '..', '..')
  it('there is ONE signature pad component', () => {
    expect(fs.existsSync(path.join(root, 'components/SignaturePad.tsx'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'components/SignaturePadInline.tsx'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'components/contracts/SignaturePad.tsx'))).toBe(true)
    const pads: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name)
        if (e.isDirectory()) { if (!['node_modules', '.next'].includes(e.name)) walk(rel); continue }
        if (/SignaturePad\w*\.tsx$/.test(e.name)) pads.push(rel)
      }
    }
    for (const d of ['app', 'components']) walk(d)
    expect(pads).toEqual([path.join('components', 'contracts', 'SignaturePad.tsx')])
  })
})
