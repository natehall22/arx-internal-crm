'use client'

import * as React from 'react'

import ConfigListEditor from '@/components/admin/ConfigListEditor'
import { Card, CardContent, Tabs, TabsContent, TabsList, TabsTrigger, toast } from '@/components/ui'
import { forgetOrgCategories } from '@/hooks/useOrgCategories'
import { CATEGORY_LABEL_MAX, type Category } from '@/lib/categories'
import { TRADE_LABEL_MAX, type OrgTrade } from '@/lib/org-trades'

type TradesResponse = { trades?: OrgTrade[]; editable?: boolean; error?: string }

/** Trades: the crews a job can need. Saved through /api/admin/job-setup/trades (the one writer). */
function TradesTab() {
  const [trades, setTrades] = React.useState<OrgTrade[] | null>(null)
  const [editable, setEditable] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    fetch('/api/admin/job-setup/trades', { cache: 'no-store' })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as TradesResponse
        if (cancelled) return
        if (!res.ok || !Array.isArray(data.trades)) return setLoadError(data.error || 'Could not load trades')
        setTrades(data.trades)
        setEditable(data.editable === true)
      })
      .catch(() => !cancelled && setLoadError('Could not load trades'))
    return () => {
      cancelled = true
    }
  }, [])

  async function save(body: Record<string, unknown>, done: string): Promise<boolean> {
    const res = await fetch('/api/admin/job-setup/trades', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = (await res.json().catch(() => ({}))) as TradesResponse
    if (!res.ok || !Array.isArray(data.trades)) {
      toast.error(data.error || 'Could not save')
      return false
    }
    setTrades(data.trades)
    toast.success(done)
    return true
  }

  if (loadError) return <p className="text-ui-base text-danger">{loadError}</p>
  if (!trades) return <p className="text-ui-base text-ink">Loading…</p>

  const label = (slug: string) => trades.find((t) => t.slug === slug)?.label ?? slug
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ui-base text-ink">
        The crews a job can need. Each job gets one crew row per trade, with its own sub, date and photo link.
      </p>
      {!editable ? (
        <p role="status" className="rounded-ui border border-surface-line bg-surface-subtle px-3 py-2 text-ui-sm text-ink">
          This is the standard list. Editing turns on once the database update for this page is applied.
        </p>
      ) : null}
      <ConfigListEditor
        noun="trade"
        readOnly={!editable}
        maxLabelLength={TRADE_LABEL_MAX}
        items={trades.map((t) => ({ key: t.slug, label: t.label, active: t.active }))}
        hint="The first trade that is on is the crew a job starts with when its type is mixed or unknown. Turning a trade off hides it from new jobs; jobs that already have it keep it."
        onAdd={(name) => save({ action: 'add', label: name }, `${name} added`)}
        onRename={(slug, name) => save({ action: 'rename', slug, label: name }, `Renamed to ${name}`)}
        onReorder={(order) => save({ action: 'reorder', order }, 'Order saved')}
        onSetActive={(slug, active) => save({ action: 'setActive', slug, active }, `${label(slug)} turned ${active ? 'on' : 'off'}`)}
      />
    </div>
  )
}

/** Categories: how the company groups its work (Residential / Commercial / New build + its own). Saved through /api/categories (the one writer). */
function CategoriesTab() {
  const [categories, setCategories] = React.useState<Category[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    fetch('/api/categories', { cache: 'no-store' })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { categories?: Category[]; error?: string }
        if (cancelled) return
        if (!res.ok || !Array.isArray(data.categories)) return setLoadError(data.error || 'Could not load categories')
        setCategories(data.categories)
      })
      .catch(() => !cancelled && setLoadError('Could not load categories'))
    return () => {
      cancelled = true
    }
  }, [])

  async function save(body: Record<string, unknown>, done: string): Promise<boolean> {
    const res = await fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = (await res.json().catch(() => ({}))) as { categories?: Category[]; error?: string }
    if (!res.ok || !Array.isArray(data.categories)) {
      toast.error(data.error || 'Could not save')
      return false
    }
    forgetOrgCategories()
    setCategories(data.categories)
    toast.success(done)
    return true
  }

  if (loadError) return <p className="text-ui-base text-danger">{loadError}</p>
  if (!categories) return <p className="text-ui-base text-ink">Loading…</p>

  const label = (slug: string) => categories.find((c) => c.slug === slug)?.label ?? slug
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ui-base text-ink">
        How you group your work. Each customer can have a category, and one job can use a different one. It shows in reports and as a filter on the Customers and Jobs lists.
      </p>
      <ConfigListEditor
        noun="category"
        minActive={0}
        maxLabelLength={CATEGORY_LABEL_MAX}
        items={categories.map((c) => ({ key: c.slug, label: c.label, active: c.active }))}
        hint="Renaming changes the name everywhere, reports included. Turning a category off hides it from new choices; customers and jobs that already have it keep it."
        onAdd={(name) => save({ action: 'add', label: name }, `${name} added`)}
        onRename={(slug, name) => save({ action: 'rename', slug, label: name }, `Renamed to ${name}`)}
        onReorder={(order) => save({ action: 'reorder', order }, 'Order saved')}
        onSetActive={(slug, active) => save({ action: 'setActive', slug, active }, `${label(slug)} turned ${active ? 'on' : 'off'}`)}
      />
    </div>
  )
}

export default function JobSetupClient() {
  return (
    <Card>
      <CardContent>
        <Tabs defaultValue="trades">
          <TabsList aria-label="Job setup">
            <TabsTrigger value="trades">Trades</TabsTrigger>
            <TabsTrigger value="categories">Categories</TabsTrigger>
          </TabsList>
          <TabsContent value="trades" className="pt-4">
            <TradesTab />
          </TabsContent>
          <TabsContent value="categories" className="pt-4">
            <CategoriesTab />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
