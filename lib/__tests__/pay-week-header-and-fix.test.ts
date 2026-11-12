/** @jest-environment node */
/** Pay this week: "Fix a mistake" is two choices + a positive amount (no signed box), and the export button follows the company's provider. */
import { signedFixAmount } from '@/lib/payroll-format'
import { EXPORT_PROVIDER_LABEL, readExportProvider } from '@/lib/payroll-provider-export'

describe('signedFixAmount', () => {
  test('Add money pays, Take money back takes back, whatever is typed', () => {
    expect(signedFixAmount('add', '322')).toBe(322)
    expect(signedFixAmount('take', '150')).toBe(-150)
    expect(signedFixAmount('take', '-150')).toBe(-150)
    expect(signedFixAmount('add', '-40.5')).toBe(40.5)
  })
})

describe('readExportProvider', () => {
  test('nothing is assumed: unset or odd = null; a saved Gusto, ADP or CSV choice is read back', () => {
    expect(readExportProvider(undefined)).toBeNull()
    expect(readExportProvider({ payrollExport: {} })).toBeNull()
    expect(readExportProvider({ payrollExport: { provider: 'paychex' } })).toBeNull()
    expect(readExportProvider({ payrollExport: { provider: 'csv' } })).toBe('csv')
    expect(readExportProvider({ payrollExport: { provider: 'adp' } })).toBe('adp')
    expect(EXPORT_PROVIDER_LABEL.adp).toBe('ADP')
  })
})
