/**
 * The record of an online quote approval, rendered from the approval's own SNAPSHOT (never from the live proposal), so the
 * file is exactly what the customer agreed to: items and options with quantity and description, tax per rate, total,
 * deposit, the terms text, and the typed name + time + IP. Company brand only (customer document).
 * Server-rendered with `renderToBuffer` (lib/quotes/pdf.ts); same react-pdf stack as ProposalPDFv2, which is a roofing
 * marketing document and is left untouched.
 */
import React from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

import { formatCents, formatDateTime } from '@/lib/format'
import { quantityWithUnit } from '@/lib/price-list'

export type QuoteApprovalPdfData = {
  company: { name: string; phone?: string; email?: string; address?: string }
  number: string | null
  title: string | null
  customerName: string
  customerAddress: string
  lines: Array<{ name: string; description: string; quantity: number | null; unit: string; optional: boolean; chosen: boolean; cents: number }>
  subtotalCents: number
  discountCents: number
  taxLines: Array<{ name: string; percent: number; amount_cents: number }>
  taxCents: number
  totalCents: number
  deposit: { cents: number; label: string }
  terms: string
  /** Recurring service lines (service plans) shown and approved; absent on a quote with none, so every other PDF is unchanged. */
  recurring?: Array<{ name: string; description: string; detail: string; termsLine: string; optional: boolean; chosen: boolean; firstSeasonCents: number }>
  approval: { typedName: string; approvedAt: string; ip: string | null }
}

const ink = '#2c2c2a'
const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: ink, fontFamily: 'Helvetica' },
  brand: { fontSize: 16, fontWeight: 'bold' },
  small: { fontSize: 9 },
  h1: { fontSize: 20, fontWeight: 'bold', marginTop: 16 },
  h2: { fontSize: 12, fontWeight: 'bold', marginTop: 16, marginBottom: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: '#999999' },
  name: { flexGrow: 1, flexShrink: 1, paddingRight: 8 },
  desc: { fontSize: 9, marginTop: 1 },
  total: { fontSize: 12, fontWeight: 'bold' },
  box: { marginTop: 18, padding: 10, borderWidth: 1, borderColor: ink },
})

export function QuoteApprovalPDF({ data }: { data: QuoteApprovalPdfData }) {
  const chosen = data.lines.filter((l) => l.chosen)
  const left = data.lines.filter((l) => !l.chosen)
  const qty = (l: QuoteApprovalPdfData['lines'][number]) => { const t = quantityWithUnit(l.quantity, l.unit); return t ? ` (${t})` : '' }
  const c = data.company
  // A recurring-only quote has no one-time lines: no one-time heading, subtotal or total.
  const hasOneTime = chosen.length > 0 || !(data.recurring && data.recurring.length > 0)
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.brand}>{c.name}</Text>
        <Text style={styles.small}>{[c.phone, c.email, c.address].filter(Boolean).join('  |  ')}</Text>
        <Text style={styles.h1}>Approved Quote{data.number ? ` ${data.number}` : ''}</Text>
        {data.title ? <Text>{data.title}</Text> : null}
        <Text style={{ marginTop: 6 }}>{data.customerName}</Text>
        <Text>{data.customerAddress}</Text>

        {hasOneTime ? <Text style={styles.h2}>What was approved</Text> : null}
        {chosen.map((l, i) => (
          <View key={i} style={styles.row} wrap={false}>
            <View style={styles.name}>
              <Text>{l.name}{qty(l)}{l.optional ? '  (optional, selected)' : ''}</Text>
              {l.description ? <Text style={styles.desc}>{l.description}</Text> : null}
            </View>
            <Text>{formatCents(l.cents)}</Text>
          </View>
        ))}
        {left.length > 0 ? (
          <View>
            <Text style={styles.h2}>Options not selected (not part of this price)</Text>
            {left.map((l, i) => (
              <Text key={i} style={styles.small}>{l.name}{qty(l)}</Text>
            ))}
          </View>
        ) : null}

        {hasOneTime ? <View style={{ marginTop: 12 }}>
          <View style={styles.row}><Text>Subtotal</Text><Text>{formatCents(data.subtotalCents)}</Text></View>
          {data.discountCents > 0 ? <View style={styles.row}><Text>Discount</Text><Text>-{formatCents(data.discountCents)}</Text></View> : null}
          {data.taxLines.length > 0
            ? data.taxLines.map((t, i) => <View key={i} style={styles.row}><Text>{t.name} ({t.percent}%)</Text><Text>{formatCents(t.amount_cents)}</Text></View>)
            : data.taxCents > 0 ? <View style={styles.row}><Text>Sales tax</Text><Text>{formatCents(data.taxCents)}</Text></View> : null}
          <View style={styles.row}><Text style={styles.total}>Total</Text><Text style={styles.total}>{formatCents(data.totalCents)}</Text></View>
          {data.deposit.cents > 0 ? <View style={styles.row}><Text>{data.deposit.label}</Text><Text>{formatCents(data.deposit.cents)}</Text></View> : null}
        </View> : null}

        {data.recurring && data.recurring.some((r) => r.chosen) ? (
          <View wrap={false}>
            <Text style={styles.h2}>Recurring service approved</Text>
            {data.recurring.filter((r) => r.chosen).map((r, i) => (
              <View key={i} style={styles.row}>
                <View style={styles.name}>
                  <Text>{r.name}{r.optional ? '  (optional, selected)' : ''}</Text>
                  <Text style={styles.desc}>{r.detail}</Text>
                  {r.description ? <Text style={styles.desc}>{r.description}</Text> : null}
                </View>
              </View>
            ))}
            {Array.from(new Set(data.recurring.filter((r) => r.chosen).map((r) => r.termsLine))).map((t, i) => <Text key={i} style={{ marginTop: 3 }}>{t}</Text>)}
            <Text style={[styles.small, { marginTop: 3 }]}>Estimated first-season value of the recurring service (counted in the sale, billed as it is performed): {formatCents(data.recurring.filter((r) => r.chosen).reduce((n, r) => n + r.firstSeasonCents, 0))}</Text>
            {data.recurring.some((r) => !r.chosen) ? <Text style={styles.small}>Not selected: {data.recurring.filter((r) => !r.chosen).map((r) => r.name).join(', ')}</Text> : null}
          </View>
        ) : null}

        {data.terms ? (
          <View wrap={false}>
            <Text style={styles.h2}>Terms agreed to</Text>
            <Text>{data.terms}</Text>
          </View>
        ) : null}

        <View style={styles.box} wrap={false}>
          <Text style={{ fontWeight: 'bold' }}>Approved online by {data.approval.typedName}</Text>
          <Text>{formatDateTime(data.approval.approvedAt)}{data.approval.ip ? `  |  IP ${data.approval.ip}` : ''}</Text>
          <Text style={styles.small}>The customer typed their name and agreed to the terms above.</Text>
        </View>
      </Page>
    </Document>
  )
}
