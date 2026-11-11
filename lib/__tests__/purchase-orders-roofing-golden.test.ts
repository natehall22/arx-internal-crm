/** @jest-environment node */
// The roofing material order is now "one kind of PO". These tests pin what its supplier sees (PDF text + email) and that
// every materials reader still ignores general purchase orders, so adding POs cannot move a roofing order.
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { inflateSync } from 'zlib'
import type { JobMaterialOrderData } from '@/lib/job-material-order'
import { generateJobMaterialOrderPDF } from '@/lib/pdf/job-material-order'
import { composeSupplierOrderEmail } from '@/lib/supplier-order-email'

/** Every text string the PDF draws, in order. Creation dates and object ids are not part of it, so it is stable. */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1')
  const out: string[] = []
  const streams = raw.match(/stream\r?\n[\s\S]*?\r?\nendstream/g) ?? []
  for (const s of streams) {
    const body = s.replace(/^stream\r?\n/, '').replace(/\r?\nendstream$/, '')
    let text = body
    try {
      text = inflateSync(Buffer.from(body, 'latin1')).toString('latin1')
    } catch {
      /* uncompressed stream */
    }
    for (const m of Array.from(text.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g))) out.push(m[1])
  }
  return out.join('\n')
}

const data: JobMaterialOrderData = {
  jobId: 'j1',
  orgName: 'Green Roofing Co',
  orgPhone: '(850) 555-0100',
  jobNumber: '26-0042',
  customerName: 'Pat Example',
  address: '12 Elm St',
  proposalNumber: 'P-00042',
  product: 'IKO Dual Black Shingles',
  accessories: '1 Pipe Boot\nChimney flashing',
  changeOrders: [{ label: 'Change order CO-001', body: 'Add 2 skylights' }],
  sections: [],
  isEmpty: true,
  generatedAt: '2026-09-29T12:00:00.000Z',
}

describe('roofing material order PDF is unchanged', () => {
  it('draws the same text (golden digest)', () => {
    const text = pdfText(generateJobMaterialOrderPDF(data))
    expect(text).toContain('Chimney flashing')
    expect(text).toContain('26-0042')
    // Pins every string the renderer draws. A deliberate wording change updates this digest on purpose.
    expect(createHash('sha256').update(text).digest('hex')).toBe(GOLDEN_PDF_TEXT_SHA)
  })
})

describe('roofing supplier email is unchanged', () => {
  it('composes the same order email', () => {
    const e = composeSupplierOrderEmail({
      kind: 'order',
      supplier: { id: 'v', name: 'ABC Supply', orderEmail: 'o@abc.test', ccEmails: [], accountNumber: null, defaultBranch: null, defaultDeliveryNotes: null, defaultForTrades: [], active: true, connectionType: 'email' },
      sender: { id: 'u', name: 'Sam', email: 'sam@green.test' },
      orgName: 'Green Roofing Co',
      orgPhone: null,
      jobNumber: '26-0042',
      poLabel: '26-0042-A',
      subject: 'PO 26-0042-A',
      deliveryDate: '2026-11-02',
      deliveryAddress: '12 Elm St',
      deliveryNotes: null,
      note: null,
      sections: [],
      changes: [],
    })
    expect(createHash('sha256').update(JSON.stringify(e)).digest('hex')).toBe(GOLDEN_EMAIL_SHA)
  })
})

describe('materials readers ignore general purchase orders', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  it.each([
    ['lib/supplier-orders.ts', /kind \?\? 'materials'\) === 'materials'/],
    ['lib/job-catch-up-db.ts', /kind \?\? 'materials'\) === 'materials'/],
    ['app/api/ops/jobs/[id]/supplier-orders/received/route.ts', /kind \?\? 'materials'\) === 'materials'/],
  ])('%s filters to kind materials', (file, re) => {
    expect(read(file)).toMatch(re)
  })
  it('a subcontractor-only vendor is never a material supplier', () => {
    expect(read('lib/supplier-orders.ts')).toMatch(/vendor_type !== 'sub'/)
  })
  it('the roofing PDF renderer was not touched by purchase orders', () => {
    expect(read('lib/pdf/job-material-order.ts')).not.toMatch(/purchase-orders|vendor_bill/)
  })
})

const GOLDEN_PDF_TEXT_SHA = '9aaf6224f84b0cf2fec60acba43d16c51cf9ca7bcd33e255b2cbb2439d35dd3b'
const GOLDEN_EMAIL_SHA = 'e4cfb2354d7a4be4483613b37f59892c6cceed8c6a59dd78bc374cac9c9d36cd'
