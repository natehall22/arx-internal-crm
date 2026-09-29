import {
  contractAddOnLines,
  contractProductText,
  stripDollarAmounts,
  type JobSignedContract,
} from '@/lib/job-contract'
import { formatAddOns } from '@/lib/job-run-sheet'

const contract = (patch: Partial<JobSignedContract>): JobSignedContract => ({
  id: 'c1',
  signedAt: null,
  agreementType: 'installation',
  pdfUrl: null,
  roofingMaterial: null,
  scopeOther: null,
  additionalProducts: null,
  exclusions: null,
  notes: null,
  ...patch,
})

describe('contract → sheet fields', () => {
  it('uses the signed product line (26-0046: only the contract had it)', () => {
    expect(contractProductText([contract({ roofingMaterial: 'IKO Harvard Slate' })])).toBe('IKO Harvard Slate')
  })

  it('joins distinct products when a split deal has two contracts', () => {
    const text = contractProductText([
      contract({ roofingMaterial: 'IKO Dual Black' }),
      contract({ id: 'c2', roofingMaterial: 'iko dual black' }),
      contract({ id: 'c3', roofingMaterial: 'Black 6" gutters' }),
    ])
    expect(text).toBe('IKO Dual Black\nBlack 6" gutters')
  })

  it('adds contract extras the proposal never listed', () => {
    expect(
      contractAddOnLines([contract({ additionalProducts: 'Remove/Re-Install 46 Solar Panels' })], ['Premier Pricing'])
    ).toEqual(['Remove/Re-Install 46 Solar Panels'])
  })

  it('skips an extra a proposal adder already covers', () => {
    expect(contractAddOnLines([contract({ additionalProducts: 'Gutters' })], ['Seamless Gutters'])).toEqual([])
  })

  it('never prints a price from the contract', () => {
    expect(contractAddOnLines([contract({ additionalProducts: 'Tree trimming - $450' })], [])).toEqual(['Tree trimming'])
    expect(stripDollarAmounts('Adding gutters: $1,395.20')).toBe('Adding gutters')
  })
})

describe('formatAddOns', () => {
  it('drops the Premier Pricing tier — it is an each-unit adder, not install work', () => {
    const text = formatAddOns(
      [
        { name: 'Premier Pricing', quantity: 5, unit: 'each', is_adder: true },
        { name: '2 Story +', quantity: 3, unit: 'percent', is_adder: true },
        { name: '4 x 8 OSB', quantity: 8, unit: 'each', is_adder: true },
      ],
      [contract({ additionalProducts: 'Remove/Re-Install 46 Solar Panels' })]
    )
    expect(text).toBe('4 x 8 OSB — 8 ea\nRemove/Re-Install 46 Solar Panels')
  })
})
