/** @jest-environment node */
import type { JobMaterialOrderData } from '@/lib/job-material-order'
import { capSpecLines, generateJobMaterialOrderPDF, SPEC_MAX_LINES } from '@/lib/pdf/job-material-order'

describe('capSpecLines', () => {
  it('prints everything when it fits', () => {
    const all = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(capSpecLines(all)).toEqual({ lines: all, hidden: 0 })
  })

  it('never drops a line without counting it, and keeps the block within the cap', () => {
    const all = ['1', '2', '3', '4', '5', '6', '7', '8']
    const { lines, hidden } = capSpecLines(all)
    expect(lines.length + 1).toBe(SPEC_MAX_LINES)
    expect(lines.length + hidden).toBe(all.length)
  })
})

describe('generateJobMaterialOrderPDF', () => {
  const base: JobMaterialOrderData = {
    jobId: 'j1',
    orgName: 'ARX Roofing & Exteriors',
    orgPhone: null,
    jobNumber: '26-0000',
    customerName: 'Test Customer',
    address: '1 Test St',
    proposalNumber: 'P-00001',
    product: 'IKO Dual Black Shingles',
    accessories: null,
    changeOrders: [],
    sections: [],
    isEmpty: true,
    generatedAt: '2026-09-29T12:00:00.000Z',
  }

  it('says how many accessory lines it left off', () => {
    const accessories = Array.from({ length: 8 }, (_, i) => `Accessory ${i + 1}`).join('\n')
    const pdf = generateJobMaterialOrderPDF({ ...base, accessories }).toString('latin1')
    expect(pdf).toContain('Accessory 5')
    expect(pdf).not.toContain('Accessory 6')
    expect(pdf).toContain('+ 3 more lines - see the job in the CRM')
  })

  it('prints a short accessory list whole, with no marker', () => {
    const pdf = generateJobMaterialOrderPDF({ ...base, accessories: '1 Pipe Boot\nChimney flashing' }).toString('latin1')
    expect(pdf).toContain('Chimney flashing')
    expect(pdf).not.toContain('more line')
  })

  it('says how many lines of a long change order it left off', () => {
    const body = Array.from({ length: 5 }, (_, i) => `CO item ${i + 1}`).join('\n')
    const pdf = generateJobMaterialOrderPDF({
      ...base,
      changeOrders: [{ label: 'Change order CO-001', body }],
    }).toString('latin1')
    expect(pdf).toContain('CO item 2')
    expect(pdf).not.toContain('CO item 3')
    expect(pdf).toContain('+ 3 more lines - see the job in the CRM')
  })
})
