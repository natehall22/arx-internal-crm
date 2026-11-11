'use client'

import { combinedTaxPercent, taxRatesByIds, type SalesTaxSettings } from '@/lib/sales-tax'

/**
 * Which company tax rates apply to this quote (rates stack). Starts with the company default stack; a retired rate
 * that an older draft already uses stays listed so it can be removed. Exempt customers are never charged.
 */
export default function SalesTaxPicker({
  settings,
  selected,
  exempt,
  onChange,
}: {
  settings: SalesTaxSettings | null
  selected: string[]
  exempt: boolean
  onChange: (ids: string[]) => void
}) {
  if (!settings?.enabled) {
    return <p className="text-sm text-[#2c2c2a]">Sales tax is turned off for your company.</p>
  }
  if (exempt) {
    return <p className="text-sm font-semibold text-[#2c2c2a]">This customer is tax exempt — no sales tax is charged.</p>
  }
  const choices = settings.rates.filter((r) => r.active || selected.includes(r.id))
  const applied = taxRatesByIds(settings, selected)
  return (
    <fieldset>
      <legend className="block text-sm font-medium text-gray-700 mb-2">Sales tax</legend>
      {choices.length === 0 ? (
        <p className="text-sm text-[#2c2c2a]">No tax rates set up yet — an owner adds them in Settings → Sales tax.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {choices.map((r) => (
            <label key={r.id} className="flex min-h-[44px] items-center gap-3 text-base text-[#2c2c2a]">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={selected.includes(r.id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? settings.rates.filter((x) => x.id === r.id || selected.includes(x.id)).map((x) => x.id)
                      : selected.filter((id) => id !== r.id)
                  )
                }
              />
              <span>
                {r.name} ({r.percent}%){r.active ? '' : ' — retired'}
              </span>
            </label>
          ))}
          <p className="text-sm text-[#2c2c2a]">Total rate {combinedTaxPercent(applied)}% on taxable lines.</p>
        </div>
      )}
    </fieldset>
  )
}
