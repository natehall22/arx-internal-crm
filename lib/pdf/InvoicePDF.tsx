import React from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { ARX_DEFAULT_OFFICE_ADDRESS } from '@/lib/company-address'
import { JobInvoice, JobInvoiceItem } from '@/lib/types/invoices'

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 11,
    fontFamily: 'Helvetica',
    color: '#333',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  companyBlock: {
    width: '50%',
  },
  companyName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a365d',
    marginBottom: 4,
  },
  companyAddress: {
    fontSize: 10,
    color: '#666',
    lineHeight: 1.4,
  },
  invoiceBlock: {
    width: '40%',
    textAlign: 'right',
  },
  invoiceTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a365d',
    marginBottom: 10,
  },
  invoiceMeta: {
    fontSize: 10,
    marginBottom: 3,
  },
  invoiceMetaLabel: {
    color: '#666',
  },
  invoiceMetaValue: {
    fontWeight: 'bold',
  },
  billTo: {
    marginBottom: 30,
    padding: 15,
    backgroundColor: '#f7fafc',
    borderRadius: 4,
  },
  billToLabel: {
    fontSize: 10,
    color: '#666',
    marginBottom: 5,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  billToName: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 3,
  },
  billToAddress: {
    fontSize: 11,
    color: '#444',
    lineHeight: 1.4,
  },
  table: {
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#1a365d',
    color: '#fff',
    padding: 10,
    fontWeight: 'bold',
    fontSize: 10,
  },
  tableRow: {
    flexDirection: 'row',
    padding: 10,
    borderBottom: '1 solid #e2e8f0',
  },
  tableRowAlt: {
    backgroundColor: '#f7fafc',
  },
  colDescription: {
    width: '45%',
  },
  colQty: {
    width: '15%',
    textAlign: 'center',
  },
  colUnitPrice: {
    width: '20%',
    textAlign: 'right',
  },
  colTotal: {
    width: '20%',
    textAlign: 'right',
  },
  totalsSection: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 30,
  },
  totalsBox: {
    width: '45%',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 8,
    borderBottom: '1 solid #e2e8f0',
  },
  totalRowFinal: {
    backgroundColor: '#1a365d',
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  totalLabel: {
    fontWeight: 'bold',
  },
  totalValue: {},
  balanceDue: {
    backgroundColor: '#c53030',
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  balancePaid: {
    backgroundColor: '#2f855a',
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  notesSection: {
    marginBottom: 30,
    padding: 15,
    backgroundColor: '#fffbeb',
    borderRadius: 4,
    borderLeft: '4 solid #d69e2e',
  },
  notesLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#744210',
    marginBottom: 5,
  },
  notesText: {
    fontSize: 10,
    color: '#744210',
    lineHeight: 1.4,
  },
  paymentSection: {
    padding: 15,
    backgroundColor: '#ebf8ff',
    borderRadius: 4,
  },
  paymentTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#2c5282',
    marginBottom: 8,
  },
  paymentText: {
    fontSize: 10,
    color: '#2c5282',
    lineHeight: 1.5,
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: 'center',
    fontSize: 9,
    color: '#999',
    borderTop: '1 solid #e2e8f0',
    paddingTop: 10,
  },
})

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const date = new Date(dateStr + 'T12:00:00')
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

interface InvoicePDFProps {
  invoice: JobInvoice
  items: JobInvoiceItem[]
  appliedCents: number
  customer: {
    name: string
    address: string
    email?: string
    phone?: string
  }
  company: {
    name: string
    address: string
    phone?: string
    email?: string
  }
}

export { type InvoicePDFProps }

export function InvoicePDF({
  invoice,
  items,
  appliedCents,
  customer,
  company,
}: InvoicePDFProps): React.ReactElement {
  const balanceCents = invoice.total_cents - appliedCents
  const isPaid = balanceCents <= 0

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.companyBlock}>
            <Text style={styles.companyName}>{company.name}</Text>
            <Text style={styles.companyAddress}>
              {company.address || ARX_DEFAULT_OFFICE_ADDRESS}
              {company.phone && `\n${company.phone}`}
              {company.email && `\n${company.email}`}
            </Text>
          </View>
          <View style={styles.invoiceBlock}>
            <Text style={styles.invoiceTitle}>INVOICE</Text>
            <Text style={styles.invoiceMeta}>
              <Text style={styles.invoiceMetaLabel}>Invoice #: </Text>
              <Text style={styles.invoiceMetaValue}>{invoice.invoice_number}</Text>
            </Text>
            <Text style={styles.invoiceMeta}>
              <Text style={styles.invoiceMetaLabel}>Date: </Text>
              <Text style={styles.invoiceMetaValue}>{formatDate(invoice.issued_at)}</Text>
            </Text>
            {invoice.due_at && (
              <Text style={styles.invoiceMeta}>
                <Text style={styles.invoiceMetaLabel}>Due Date: </Text>
                <Text style={styles.invoiceMetaValue}>{formatDate(invoice.due_at)}</Text>
              </Text>
            )}
          </View>
        </View>

        {/* Bill To */}
        <View style={styles.billTo}>
          <Text style={styles.billToLabel}>Bill To</Text>
          <Text style={styles.billToName}>{customer.name}</Text>
          <Text style={styles.billToAddress}>
            {customer.address}
            {customer.phone && `\n${customer.phone}`}
            {customer.email && `\n${customer.email}`}
          </Text>
        </View>

        {/* Line Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colDescription}>Description</Text>
            <Text style={styles.colQty}>Qty</Text>
            <Text style={styles.colUnitPrice}>Unit Price</Text>
            <Text style={styles.colTotal}>Total</Text>
          </View>
          {items.map((item, index) => (
            <View
              key={item.id}
              style={index % 2 === 1 ? [styles.tableRow, styles.tableRowAlt] : styles.tableRow}
            >
              <Text style={styles.colDescription}>{item.description}</Text>
              <Text style={styles.colQty}>{item.qty}</Text>
              <Text style={styles.colUnitPrice}>{formatCurrency(item.unit_price_cents)}</Text>
              <Text style={styles.colTotal}>{formatCurrency(item.line_total_cents)}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totalsSection}>
          <View style={styles.totalsBox}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>{formatCurrency(invoice.subtotal_cents)}</Text>
            </View>
            <View style={[styles.totalRow, styles.totalRowFinal]}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>{formatCurrency(invoice.total_cents)}</Text>
            </View>
            {appliedCents > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Payments Applied</Text>
                <Text style={styles.totalValue}>({formatCurrency(appliedCents)})</Text>
              </View>
            )}
            <View style={[styles.totalRow, isPaid ? styles.balancePaid : styles.balanceDue]}>
              <Text style={styles.totalLabel}>Balance Due</Text>
              <Text style={styles.totalValue}>
                {isPaid ? 'PAID' : formatCurrency(balanceCents)}
              </Text>
            </View>
          </View>
        </View>

        {/* Notes */}
        {invoice.notes && (
          <View style={styles.notesSection}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesText}>{invoice.notes}</Text>
          </View>
        )}

        {/* Payment Instructions */}
        {!isPaid && (
          <View style={styles.paymentSection}>
            <Text style={styles.paymentTitle}>Payment Instructions</Text>
            <Text style={styles.paymentText}>
              Please make payment by the due date shown above.{'\n'}
              Accepted payment methods: Check, Credit Card, ACH Bank Transfer{'\n'}
              {'\n'}
              For questions about this invoice, please contact us at:{'\n'}
              {company.phone || company.email || 'our office'}
            </Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text>Thank you for your business!</Text>
          <Text>{company.name} • {invoice.invoice_number}</Text>
        </View>
      </Page>
    </Document>
  )
}
