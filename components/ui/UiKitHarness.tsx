'use client'

/** Dev-harness only (app/dev-harness/ui-kit): every kit piece on one screen so Playwright can check it at phone widths. */
import type { ColumnDef } from '@tanstack/react-table'
import * as React from 'react'

import { Button, Card, CardContent, CardHeader, CardTitle, DataTable, Dialog, DialogContent, DialogFooter, EmptyState, Field, Input, PageHeader, StatusPill, Tabs, TabsContent, TabsList, TabsTrigger, toast, confirmDialog } from '@/components/ui'
import { formatMoney } from '@/lib/format'

type Row = { name: string; status: string; total: number }
const ROWS: Row[] = [
  { name: 'Ashley Gaines', status: 'in_progress', total: 18430.5 },
  { name: 'Bill Cox', status: 'complete', total: 1632500 / 100 },
  { name: 'Dana Whitfield', status: 'sold', total: 24310 },
]
const COLUMNS: ColumnDef<Row, any>[] = [
  { accessorKey: 'name', header: 'Customer', meta: { mobile: 'title' } },
  { accessorKey: 'status', header: 'Status', cell: (c) => <StatusPill domain="job" value={c.getValue()} /> },
  { accessorKey: 'total', header: 'Total', cell: (c) => formatMoney(c.getValue()), meta: { align: 'right' } },
]

export default function UiKitHarness() {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <PageHeader title="Pay this week" subtitle="Kit preview" actions={<Button onClick={() => setOpen(true)}>Open sheet</Button>} />
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Overview</TabsTrigger>
          <TabsTrigger value="b">Money</TabsTrigger>
        </TabsList>
        <TabsContent value="a" className="pt-3">
          <Card>
            <CardHeader><CardTitle>Jobs</CardTitle></CardHeader>
            <CardContent>
              <DataTable columns={COLUMNS} data={ROWS} tableKey="harness" searchPlaceholder="Search jobs" />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="b"><EmptyState title="Nothing owed" body="Everything on this job is paid." /></TabsContent>
      </Tabs>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => toast.success('Saved')}>Toast</Button>
        <Button variant="danger" onClick={() => confirmDialog({ title: 'Delete this?', destructive: true })}>Confirm</Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Save this view" description="Name it.">
          <Field label="Name">{(p) => <Input {...p} />}</Field>
          <DialogFooter><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
