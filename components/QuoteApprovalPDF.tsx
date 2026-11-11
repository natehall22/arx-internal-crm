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
  const qty = (l: QuoteApprovalPdfData['lines'][number]) => (l.quantity != null && l.quantity !== 1 ? ` (${l.quantity}${l.unit && l.unit !== 'each' ? ` ${l.unit}` : ''})` : '')
  const c = data.company
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.brand}>{c.name}</Text>
        <Text style={styles.small}>{[c.phone, c.email, c.address].filter(Boolean).join('  |  ')}</Text>
        <Text style={styles.h1}>Approved Quote{data.number ? ` ${data.number}` : ''}</Text>
        {data.title ? <Text>{data.title}</Text> : null}
        <Text style={{ marginTop: 6 }}>{data.customerName}</Text>
        <Text>{data.customerAddress}</Text>

        <Text style={styles.h2}>What was approved</Text>
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

        <View style={{ marginTop: 12 }}>
          <View style={styles.row}><Text>Subtotal</Text><Text>{formatCents(data.subtotalCents)}</Text></View>
          {data.discountCents > 0 ? <View style={styles.row}><Text>Discount</Text><Text>-{formatCents(data.discountCents)}</Text></View> : null}
          {data.taxLines.length > 0
            ? data.taxLines.map((t, i) => <View key={i} style={styles.row}><Text>{t.name} ({t.percent}%)</Text><Text>{formatCents(t.amount_cents)}</Text></View>)
            : data.taxCents > 0 ? <View style={styles.row}><Text>Sales tax</Text><Text>{formatCents(data.taxCents)}</Text></View> : null}
          <View style={styles.row}><Text style={styles.total}>Total</Text><Text style={styles.total}>{formatCents(data.totalCents)}</Text></View>
          {data.deposit.cents > 0 ? <View style={styles.row}><Text>{data.deposit.label}</Text><Text>{formatCents(data.deposit.cents)}</Text></View> : null}
        </View>

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
