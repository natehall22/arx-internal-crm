import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { Estimate, EstimateLine, Project } from '@/lib/types/database'

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 12,
    fontFamily: 'Helvetica',
  },
  header: {
    marginBottom: 30,
    borderBottom: '2 solid #000',
    paddingBottom: 10,
  },
  companyName: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    borderBottom: '1 solid #ccc',
    paddingBottom: 5,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 5,
  },
  label: {
    width: '30%',
    fontWeight: 'bold',
  },
  value: {
    width: '70%',
  },
  table: {
    marginTop: 10,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    padding: 8,
    fontWeight: 'bold',
    borderBottom: '1 solid #ccc',
  },
  tableRow: {
    flexDirection: 'row',
    padding: 8,
    borderBottom: '1 solid #eee',
  },
  colName: {
    width: '40%',
  },
  colQty: {
    width: '15%',
    textAlign: 'right',
  },
  colPrice: {
    width: '20%',
    textAlign: 'right',
  },
  colTotal: {
    width: '25%',
    textAlign: 'right',
  },
  totals: {
    marginTop: 20,
    alignSelf: 'flex-end',
    width: '40%',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
    padding: 5,
  },
  totalLabel: {
    fontWeight: 'bold',
  },
  totalValue: {
    fontWeight: 'bold',
  },
  scope: {
    marginTop: 20,
    padding: 10,
    backgroundColor: '#f9f9f9',
  },
  scopeText: {
    lineHeight: 1.5,
  },
})

interface ProposalPDFProps {
  estimate: Estimate & { projects: Project }
  lines: EstimateLine[]
  customerName?: string
}

export function ProposalPDF({ estimate, lines, customerName }: ProposalPDFProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.companyName}>ARX Roofing</Text>
          <Text>Proposal / Estimate</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Project Information</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Customer:</Text>
            <Text style={styles.value}>{customerName || 'N/A'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Address:</Text>
            <Text style={styles.value}>{estimate.projects.address_text || 'N/A'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Estimate #:</Text>
            <Text style={styles.value}>{estimate.id.slice(0, 8)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Date:</Text>
            <Text style={styles.value}>
              {new Date(estimate.created_at).toLocaleDateString()}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Line Items</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.colName}>Item</Text>
              <Text style={styles.colQty}>Qty</Text>
              <Text style={styles.colPrice}>Unit Price</Text>
              <Text style={styles.colTotal}>Total</Text>
            </View>
            {lines.map((line) => (
              <View key={line.id} style={styles.tableRow}>
                <Text style={styles.colName}>
                  {line.name}
                  {line.is_labor && ' (Labor)'}
                </Text>
                <Text style={styles.colQty}>{line.qty}</Text>
                <Text style={styles.colPrice}>${line.unit_price.toFixed(2)}</Text>
                <Text style={styles.colTotal}>${line.line_total.toFixed(2)}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal:</Text>
            <Text style={styles.totalValue}>${estimate.subtotal.toFixed(2)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Tax ({estimate.tax_rate * 100}%):</Text>
            <Text style={styles.totalValue}>${estimate.tax.toFixed(2)}</Text>
          </View>
          <View style={[styles.totalRow, { borderTop: '2 solid #000', paddingTop: 10 }]}>
            <Text style={styles.totalLabel}>Total:</Text>
            <Text style={[styles.totalValue, { fontSize: 16 }]}>
              ${estimate.total.toFixed(2)}
            </Text>
          </View>
        </View>

        {estimate.scope_text && (
          <View style={styles.scope}>
            <Text style={styles.sectionTitle}>Scope of Work</Text>
            <Text style={styles.scopeText}>{estimate.scope_text}</Text>
          </View>
        )}
      </Page>
    </Document>
  )
}
