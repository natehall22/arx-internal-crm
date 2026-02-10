import { validateRequiredAdders } from '../required-adders'
import type { EstimateLine, Project } from '@/lib/types/database'

describe('validateRequiredAdders', () => {
  const baseLine: EstimateLine = {
    id: '1',
    org_id: 'org-1',
    estimate_id: 'est-1',
    pricebook_item_id: null,
    category: 'roofing',
    name: 'Test',
    unit: 'square',
    qty: 1,
    unit_price: 100,
    line_total: 100,
    is_labor: false,
    is_taxable: true,
    sort_order: 0,
    created_at: '',
    updated_at: '',
  }

  const baseProject: Project = {
    id: 'project-1',
    org_id: 'org-1',
    customer_id: null,
    lead_id: null,
    owner_user_id: null,
    status: 'open',
    project_type: 'roofing',
    address_text: null,
    lat: null,
    lng: null,
    roof_squares: 30,
    siding_squares: null,
    vents_count: 5,
    layers: 1,
    total_windows: 0,
    windows_by_type: null,
    notes: null,
    contract_sent_at: null,
    contract_uploaded_at: null,
    contract_pdf_path: null,
    scope_of_work: null,
    permits_status: null,
    product_summary: null,
    install_date: null,
    ops_notes: null,
    created_at: '',
    updated_at: '',
  }

  it('requires dump/haul when roof install exists', () => {
    const lines: EstimateLine[] = [
      { ...baseLine, name: 'Roof Install', category: 'roofing' },
    ]

    const issues = validateRequiredAdders(lines, baseProject)

    expect(issues.length).toBeGreaterThan(0)
    expect(issues.some((i) => i.message.includes('Dump/Haul Away'))).toBe(true)
  })

  it('requires cleanup when tear-off exists', () => {
    const lines: EstimateLine[] = [
      { ...baseLine, name: 'Tear-off 1 Layer', category: 'roofing' },
    ]

    const issues = validateRequiredAdders(lines, baseProject)

    expect(issues.length).toBeGreaterThan(0)
    expect(issues.some((i) => i.message.includes('Clean-up'))).toBe(true)
  })

  it('requires pipe boots >= vents count', () => {
    const lines: EstimateLine[] = [
      { ...baseLine, name: 'Roof Install', category: 'roofing' },
      { ...baseLine, name: 'Pipe Boots', category: 'addons', qty: 3, line_total: 75 },
    ]

    const issues = validateRequiredAdders(lines, { ...baseProject, vents_count: 5 })

    expect(issues.length).toBeGreaterThan(0)
    expect(issues.some((i) => i.message.includes('Pipe Boots'))).toBe(true)
  })

  it('requires window disposal when windows exist', () => {
    const lines: EstimateLine[] = [
      { ...baseLine, name: 'Window Install', category: 'windows' },
    ]

    const issues = validateRequiredAdders(lines, { ...baseProject, total_windows: 5 })

    expect(issues.length).toBeGreaterThan(0)
    expect(issues.some((i) => i.message.includes('Window Disposal'))).toBe(true)
  })

  it('passes when all required adders are present', () => {
    const lines: EstimateLine[] = [
      { ...baseLine, name: 'Roof Install', category: 'roofing' },
      { ...baseLine, name: 'Dump/Haul Away', category: 'addons', unit: 'job', line_total: 250 },
      { ...baseLine, name: 'Pipe Boots', category: 'addons', qty: 5, line_total: 125 },
    ]

    const issues = validateRequiredAdders(lines, baseProject)

    expect(issues.length).toBe(0)
  })
})
