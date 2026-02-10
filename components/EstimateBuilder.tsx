'use client'

import { useState, useEffect } from 'react'
import type { Estimate, EstimateLine, Project, PricebookItem } from '@/lib/types/database'
import { calculateEstimateTotals } from '@/lib/calculations'
import { validateRequiredAdders } from '@/lib/required-adders'

interface EstimateBuilderProps {
  estimate: Estimate & { projects: Project }
  initialLines: EstimateLine[]
  pricebookItems: PricebookItem[]
  project: Project
}

export default function EstimateBuilder({
  estimate: initialEstimate,
  initialLines,
  pricebookItems,
  project,
}: EstimateBuilderProps) {
  const [estimate, setEstimate] = useState(initialEstimate)
  const [lines, setLines] = useState(initialLines)
  const [steepPct, setSteepPct] = useState(initialEstimate.steep_multiplier_pct)
  const [highPct, setHighPct] = useState(initialEstimate.high_multiplier_pct)
  const [discount, setDiscount] = useState(initialEstimate.discount_amount)
  const [taxRate, setTaxRate] = useState(initialEstimate.tax_rate)
  const [showAddLine, setShowAddLine] = useState(false)
  const [selectedPricebookItem, setSelectedPricebookItem] = useState<string>('')
  const [manualLine, setManualLine] = useState({
    name: '',
    category: 'roofing' as const,
    unit: 'square' as const,
    qty: 1,
    unitPrice: 0,
    isLabor: false,
    isTaxable: true,
  })
  const [requiredAdderIssues, setRequiredAdderIssues] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  // Recalculate totals when lines or multipliers change
  useEffect(() => {
    const result = calculateEstimateTotals(lines, steepPct, highPct, taxRate, discount)
    setEstimate((prev) => ({
      ...prev,
      subtotal: result.subtotal,
      tax: result.tax,
      total: result.total,
    }))
  }, [lines, steepPct, highPct, taxRate, discount])

  // Validate required adders
  useEffect(() => {
    const issues = validateRequiredAdders(lines, project)
    setRequiredAdderIssues(issues)
  }, [lines, project])

  const addLineFromPricebook = async () => {
    if (!selectedPricebookItem) return

    const item = pricebookItems.find((i) => i.id === selectedPricebookItem)
    if (!item) return

    const newLine: Partial<EstimateLine> = {
      estimate_id: estimate.id,
      org_id: estimate.org_id,
      pricebook_item_id: item.id,
      category: item.category,
      name: item.name,
      unit: item.unit,
      qty: 1,
      unit_price: item.unit_price,
      is_labor: item.is_labor,
      is_taxable: item.is_taxable,
      sort_order: lines.length,
    }

    setLoading(true)
    const res = await fetch(`/api/estimates/${estimate.id}/lines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newLine),
    })

    if (res.ok) {
      const created = await res.json()
      setLines([...lines, created])
      setSelectedPricebookItem('')
      setShowAddLine(false)
    }
    setLoading(false)
  }

  const addManualLine = async () => {
    const newLine: Partial<EstimateLine> = {
      estimate_id: estimate.id,
      org_id: estimate.org_id,
      category: manualLine.category,
      name: manualLine.name,
      unit: manualLine.unit,
      qty: manualLine.qty,
      unit_price: manualLine.unitPrice,
      is_labor: manualLine.isLabor,
      is_taxable: manualLine.isTaxable,
      sort_order: lines.length,
    }

    setLoading(true)
    const res = await fetch(`/api/estimates/${estimate.id}/lines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newLine),
    })

    if (res.ok) {
      const created = await res.json()
      setLines([...lines, created])
      setManualLine({
        name: '',
        category: 'roofing',
        unit: 'square',
        qty: 1,
        unitPrice: 0,
        isLabor: false,
        isTaxable: true,
      })
      setShowAddLine(false)
    }
    setLoading(false)
  }

  const updateLine = async (lineId: string, updates: Partial<EstimateLine>) => {
    setLoading(true)
    const res = await fetch(`/api/estimates/${estimate.id}/lines/${lineId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })

    if (res.ok) {
      const updated = await res.json()
      setLines(lines.map((l) => (l.id === lineId ? updated : l)))
    }
    setLoading(false)
  }

  const deleteLine = async (lineId: string) => {
    setLoading(true)
    const res = await fetch(`/api/estimates/${estimate.id}/lines/${lineId}`, {
      method: 'DELETE',
    })

    if (res.ok) {
      setLines(lines.filter((l) => l.id !== lineId))
    }
    setLoading(false)
  }

  const saveEstimate = async () => {
    setLoading(true)
    const res = await fetch(`/api/estimates/${estimate.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        steep_multiplier_pct: steepPct,
        high_multiplier_pct: highPct,
        discount_amount: discount,
        tax_rate: taxRate,
        subtotal: estimate.subtotal,
        tax: estimate.tax,
        total: estimate.total,
      }),
    })

    if (res.ok) {
      alert('Estimate saved!')
    }
    setLoading(false)
  }

  const generatePDF = async () => {
    if (requiredAdderIssues.length > 0) {
      alert('Please fix required adders before generating PDF')
      return
    }

    setLoading(true)
    const res = await fetch(`/api/estimates/${estimate.id}/pdf`, {
      method: 'POST',
    })

    if (res.ok) {
      const data = await res.json()
      window.open(data.downloadUrl, '_blank')
    } else {
      alert('Failed to generate PDF')
    }
    setLoading(false)
  }

  const runSanityCheck = async () => {
    setLoading(true)
    const res = await fetch(`/api/ai/sanity-check?estimate_id=${estimate.id}`)
    if (res.ok) {
      const data = await res.json()
      alert(JSON.stringify(data, null, 2))
    }
    setLoading(false)
  }

  const generateScope = async () => {
    setLoading(true)
    const res = await fetch(`/api/ai/scope?estimate_id=${estimate.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estimate_id: estimate.id }),
    })
    if (res.ok) {
      const data = await res.json()
      setEstimate((prev) => ({ ...prev, scope_text: data.scope_text }))
      alert('Scope generated!')
    }
    setLoading(false)
  }

  const addRequiredAdder = async (issue: any) => {
    if (!issue.requiredItem) return

    const item = pricebookItems.find(
      (i) =>
        i.category === issue.requiredItem.category &&
        i.item_type === issue.requiredItem.itemType &&
        i.name.toLowerCase().includes(issue.requiredItem.name.toLowerCase().split(' ')[0])
    )

    if (item) {
      const newLine: Partial<EstimateLine> = {
        estimate_id: estimate.id,
        org_id: estimate.org_id,
        pricebook_item_id: item.id,
        category: item.category,
        name: item.name,
        unit: item.unit,
        qty: issue.requiredItem.minQty || 1,
        unit_price: item.unit_price,
        is_labor: item.is_labor,
        is_taxable: item.is_taxable,
        sort_order: lines.length,
      }

      setLoading(true)
      const res = await fetch(`/api/estimates/${estimate.id}/lines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLine),
      })

      if (res.ok) {
        const created = await res.json()
        setLines([...lines, created])
      }
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold text-gray-900">Estimate Builder</h1>
          <div className="flex gap-2">
            <button
              onClick={runSanityCheck}
              disabled={loading}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              AI Sanity Check
            </button>
            <button
              onClick={generateScope}
              disabled={loading}
              className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700 disabled:opacity-50"
            >
              Generate Scope
            </button>
            <button
              onClick={generatePDF}
              disabled={loading || requiredAdderIssues.length > 0}
              className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              Generate PDF
            </button>
            <button
              onClick={saveEstimate}
              disabled={loading}
              className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>

        {requiredAdderIssues.length > 0 && (
          <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded">
            <h3 className="font-bold text-yellow-800 mb-2">Required Adders Missing:</h3>
            {requiredAdderIssues.map((issue, idx) => (
              <div key={idx} className="flex items-center justify-between mb-2">
                <span className="text-yellow-700">{issue.message}</span>
                {issue.requiredItem && (
                  <button
                    onClick={() => addRequiredAdder(issue)}
                    className="text-sm bg-yellow-600 text-white px-3 py-1 rounded hover:bg-yellow-700"
                  >
                    Fix it
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700">Steep %</label>
            <input
              type="number"
              step="0.01"
              value={steepPct}
              onChange={(e) => setSteepPct(parseFloat(e.target.value) || 0)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">High %</label>
            <input
              type="number"
              step="0.01"
              value={highPct}
              onChange={(e) => setHighPct(parseFloat(e.target.value) || 0)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Discount</label>
            <input
              type="number"
              step="0.01"
              value={discount}
              onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Tax Rate</label>
            <input
              type="number"
              step="0.0001"
              value={taxRate}
              onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm"
            />
          </div>
        </div>

        <div className="mb-4">
          <button
            onClick={() => setShowAddLine(!showAddLine)}
            className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700"
          >
            {showAddLine ? 'Cancel' : 'Add Line'}
          </button>
        </div>

        {showAddLine && (
          <div className="mb-6 p-4 border rounded">
            <h3 className="font-bold mb-2">Add from Pricebook</h3>
            <div className="flex gap-2 mb-4">
              <select
                value={selectedPricebookItem}
                onChange={(e) => setSelectedPricebookItem(e.target.value)}
                className="flex-1 rounded-md border-gray-300"
              >
                <option value="">Select item...</option>
                {pricebookItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} - ${item.unit_price.toFixed(2)}/{item.unit}
                  </option>
                ))}
              </select>
              <button
                onClick={addLineFromPricebook}
                disabled={!selectedPricebookItem || loading}
                className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                Add
              </button>
            </div>

            <h3 className="font-bold mb-2">Or Add Manual Line</h3>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              <input
                type="text"
                placeholder="Name"
                value={manualLine.name}
                onChange={(e) => setManualLine({ ...manualLine, name: e.target.value })}
                className="rounded-md border-gray-300"
              />
              <select
                value={manualLine.category}
                onChange={(e) =>
                  setManualLine({ ...manualLine, category: e.target.value as any })
                }
                className="rounded-md border-gray-300"
              >
                <option value="roofing">Roofing</option>
                <option value="siding">Siding</option>
                <option value="windows">Windows</option>
                <option value="addons">Addons</option>
              </select>
              <select
                value={manualLine.unit}
                onChange={(e) => setManualLine({ ...manualLine, unit: e.target.value as any })}
                className="rounded-md border-gray-300"
              >
                <option value="square">Square</option>
                <option value="each">Each</option>
                <option value="lf">LF</option>
                <option value="sheet">Sheet</option>
                <option value="job">Project</option>
              </select>
              <input
                type="number"
                placeholder="Qty"
                value={manualLine.qty}
                onChange={(e) =>
                  setManualLine({ ...manualLine, qty: parseFloat(e.target.value) || 0 })
                }
                className="rounded-md border-gray-300"
              />
              <input
                type="number"
                step="0.01"
                placeholder="Unit Price"
                value={manualLine.unitPrice}
                onChange={(e) =>
                  setManualLine({ ...manualLine, unitPrice: parseFloat(e.target.value) || 0 })
                }
                className="rounded-md border-gray-300"
              />
              <button
                onClick={addManualLine}
                disabled={!manualLine.name || loading}
                className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                Add Manual
              </button>
            </div>
            <div className="mt-2 flex gap-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={manualLine.isLabor}
                  onChange={(e) => setManualLine({ ...manualLine, isLabor: e.target.checked })}
                  className="mr-2"
                />
                Labor
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={manualLine.isTaxable}
                  onChange={(e) => setManualLine({ ...manualLine, isTaxable: e.target.checked })}
                  className="mr-2"
                />
                Taxable
              </label>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Qty
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Unit Price
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Total
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {line.name}
                    {line.is_labor && <span className="ml-2 text-xs text-blue-600">(Labor)</span>}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <input
                      type="number"
                      step="0.01"
                      value={line.qty}
                      onChange={(e) =>
                        updateLine(line.id, { qty: parseFloat(e.target.value) || 0 })
                      }
                      className="w-20 rounded-md border-gray-300"
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <input
                      type="number"
                      step="0.01"
                      value={line.unit_price}
                      onChange={(e) =>
                        updateLine(line.id, { unit_price: parseFloat(e.target.value) || 0 })
                      }
                      className="w-24 rounded-md border-gray-300"
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${line.line_total.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <button
                      onClick={() => deleteLine(line.id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 p-4 bg-gray-50 rounded">
          <div className="flex justify-end space-x-6">
            <div>
              <span className="text-sm text-gray-600">Subtotal:</span>
              <span className="ml-2 text-lg font-bold">${estimate.subtotal.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-sm text-gray-600">Tax:</span>
              <span className="ml-2 text-lg font-bold">${estimate.tax.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-sm text-gray-600">Total:</span>
              <span className="ml-2 text-xl font-bold">${estimate.total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {estimate.scope_text && (
          <div className="mt-6 p-4 bg-white border rounded">
            <h3 className="font-bold mb-2">Scope of Work</h3>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{estimate.scope_text}</p>
          </div>
        )}
      </div>
    </div>
  )
}
