/** @jest-environment node */
import { checkAgainstLists } from '@/lib/quickbooks/mapping-screen'
import { EMPTY_QB_SETTINGS, readQbSettings } from '@/lib/quickbooks/mapping'
import type { QbLists } from '@/lib/quickbooks/lists'

const lists: QbLists = {
  country: 'US',
  items: [{ id: '5', name: 'Roofing', type: 'Service' }],
  incomeAccounts: [],
  depositAccounts: [{ id: '35', name: 'Undeposited Funds', subType: 'UndepositedFunds' }],
  receivableAccounts: [{ id: '84', name: 'Accounts Receivable' }],
  expenseAccounts: [{ id: '70', name: 'Subcontractors' }],
  taxCodes: [{ id: 'T1', name: 'NC', rates: [{ id: 'R1', name: 'State', percent: 4.75 }] }] as QbLists['taxCodes'],
  classes: [],
  customTxnNumbers: null,
  unreadable: [],
}

describe('mapping screen: choices must be QuickBooks’ own', () => {
  it('accepts picks that exist', () => {
    const s = readQbSettings({ quickbooks: { income: { defaultItemId: '5' }, depositToAccountId: '35', bills: { enabled: true, expenseAccountId: '70' } } })
    expect(checkAgainstLists(s, lists)).toBeNull()
  })
  it.each([
    [{ income: { defaultItemId: '999' } }, /sales item/],
    [{ depositToAccountId: '999' }, /deposit account/],
    [{ bills: { enabled: true, expenseAccountId: '999' } }, /expense account/],
    [{ tax: { mode: 'code', taxCodeId: 'nope' } }, /tax code/],
    [{ tax: { mode: 'code', taxCodeId: 'T1', rateMap: { crm: 'R9' } } }, /tax rate/],
  ])('rejects an id QuickBooks does not have: %j', (patch, re) => {
    expect(checkAgainstLists(readQbSettings({ quickbooks: patch }), lists)).toMatch(re)
  })
  it('empty settings pass (nothing chosen yet)', () => {
    expect(checkAgainstLists({ ...EMPTY_QB_SETTINGS }, lists)).toBeNull()
  })
})

import { backfillDone } from '@/lib/quickbooks/mapping-screen'
describe('backfill gate', () => {
  it('is done only once apply stored a time', () => {
    expect(backfillDone({})).toBe(false)
    expect(backfillDone({ quickbooks: { backfill: {} } })).toBe(false)
    expect(backfillDone({ quickbooks: { backfill: { doneAt: '2026-11-12T00:00:00Z' } } })).toBe(true)
  })
})
