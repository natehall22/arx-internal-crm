'use client'

import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'

// Using built-in Helvetica font for reliability (no external font loading required)

interface ProposalData {
  proposal: {
    id: string
    proposal_number: string
    customer_name: string
    customer_email?: string
    customer_phone?: string
    customer_address: string
    title: string
    status: string
    subtotal: number
    discount_amount: number
    discount_percent: number
    tax_rate: number
    tax_amount: number
    total: number
    financing_available: boolean
    financing_term_months?: number
    financing_rate?: number
    monthly_payment?: number
    scope_of_work?: string
    warranty_info?: string
    accent_color: string
    created_at: string
  }
  lineItems: Array<{
    id: string
    category: string
    name: string
    unit: string
    quantity: number
    unit_price: number
    line_total: number
    is_adder: boolean
    show_to_customer?: boolean  // Whether this item should be shown on customer-facing proposal
  }>
  measurement?: {
    total_squares: number
    total_area_sqft: number
    predominant_pitch: string
    facet_count: number
    ridges_lf?: number
    eaves_lf?: number
    valleys_lf?: number
  }
  company?: {
    name: string
    logo_url?: string
    phone?: string
    email?: string
    address?: string
    website?: string
  }
  rep?: {
    full_name: string
    email?: string
    phone?: string
  }
  satelliteImageUrl?: string
}

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    paddingTop: 0,
    paddingBottom: 40,
    paddingHorizontal: 0,
    backgroundColor: '#ffffff',
  },
  // Cover Page - Printer friendly (white background, minimal ink)
  coverPage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    padding: 50,
    borderWidth: 3,
    borderColor: '#1e293b',
    margin: 30,
  },
  coverLogo: {
    marginBottom: 30,
    alignItems: 'center',
  },
  coverLogoImage: {
    maxWidth: 180,
    maxHeight: 60,
    objectFit: 'contain',
  },
  coverLogoText: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  coverTitle: {
    fontSize: 36,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
    marginBottom: 8,
    textAlign: 'center',
  },
  coverSubtitle: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 50,
    textAlign: 'center',
  },
  coverDivider: {
    width: 80,
    height: 3,
    backgroundColor: '#3b82f6',
    marginBottom: 50,
  },
  coverCustomer: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
    marginBottom: 8,
    textAlign: 'center',
  },
  coverAddress: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 50,
  },
  coverPrice: {
    padding: 25,
    borderWidth: 2,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  coverPriceLabel: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  coverPriceValue: {
    fontSize: 42,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
  },
  coverDate: {
    marginTop: 40,
    fontSize: 10,
    color: '#94a3b8',
  },
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 30,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  companyInfo: {
    flex: 1,
  },
  companyName: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
    marginBottom: 4,
  },
  companyDetail: {
    fontSize: 9,
    color: '#64748b',
    marginBottom: 2,
  },
  proposalInfo: {
    alignItems: 'flex-end',
  },
  proposalNumber: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
    marginBottom: 4,
  },
  proposalDate: {
    fontSize: 9,
    color: '#64748b',
  },
  // Content
  content: {
    padding: 30,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: '#3b82f6',
  },
  // Customer Info
  customerGrid: {
    flexDirection: 'row',
    gap: 40,
  },
  customerColumn: {
    flex: 1,
  },
  label: {
    fontSize: 8,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  value: {
    fontSize: 11,
    color: '#1e293b',
    marginBottom: 12,
  },
  // Measurement Box
  measurementBox: {
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    padding: 20,
    marginBottom: 24,
  },
  measurementTitle: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
    marginBottom: 16,
  },
  measurementGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
  },
  measurementItem: {
    width: '22%',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#ffffff',
    borderRadius: 6,
  },
  measurementValue: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: '#3b82f6',
    marginBottom: 4,
  },
  measurementLabel: {
    fontSize: 8,
    color: '#64748b',
    textTransform: 'uppercase',
  },
  // Scope of Work
  scopeText: {
    fontSize: 10,
    color: '#475569',
    lineHeight: 1.6,
  },
  // Pricing Table
  table: {
    marginTop: 8,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    padding: 10,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  tableHeaderCell: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tableRowAlt: {
    backgroundColor: '#f8fafc',
  },
  tableCell: {
    fontSize: 9,
    color: '#475569',
  },
  tableCellBold: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
  },
  col1: { width: '45%' },
  col2: { width: '15%', textAlign: 'right' },
  col3: { width: '20%', textAlign: 'right' },
  col4: { width: '20%', textAlign: 'right' },
  // Totals
  totalsBox: {
    marginTop: 16,
    marginLeft: 'auto',
    width: '50%',
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 16,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  totalLabel: {
    fontSize: 10,
    color: '#64748b',
  },
  totalValue: {
    fontSize: 10,
    color: '#1e293b',
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 12,
    marginTop: 8,
    borderTopWidth: 2,
    borderTopColor: '#3b82f6',
  },
  grandTotalLabel: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#1e293b',
  },
  grandTotalValue: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#22c55e',
  },
  // Financing
  financingBox: {
    marginTop: 24,
    padding: 20,
    backgroundColor: '#eff6ff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  financingTitle: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#1e40af',
    marginBottom: 8,
  },
  financingAmount: {
    fontSize: 24,
    fontFamily: 'Helvetica-Bold',
    color: '#1e40af',
  },
  financingTerms: {
    fontSize: 9,
    color: '#3b82f6',
    marginTop: 4,
  },
  // Warranty
  warrantyBox: {
    padding: 16,
    backgroundColor: '#f0fdf4',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  warrantyTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#166534',
    marginBottom: 8,
  },
  warrantyText: {
    fontSize: 9,
    color: '#15803d',
    lineHeight: 1.5,
  },
  // Footer
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    backgroundColor: '#f8fafc',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 8,
    color: '#64748b',
  },
  // Signature
  signatureSection: {
    marginTop: 40,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  signatureGrid: {
    flexDirection: 'row',
    gap: 40,
  },
  signatureBox: {
    flex: 1,
  },
  signatureLine: {
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    marginBottom: 8,
    height: 40,
  },
  signatureLabel: {
    fontSize: 9,
    color: '#64748b',
  },
  // Satellite Image
  satelliteSection: {
    marginBottom: 24,
  },
  satelliteImage: {
    width: '100%',
    height: 200,
    objectFit: 'cover',
    borderRadius: 8,
  },
  satelliteCaption: {
    fontSize: 8,
    color: '#64748b',
    marginTop: 4,
    textAlign: 'center',
  },
})

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount)
}

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export const ProposalPDF = ({ data }: { data: ProposalData }) => {
  const { proposal, lineItems, measurement, company, rep, satelliteImageUrl } = data

  return (
    <Document>
      {/* Cover Page - Printer Friendly */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.coverPage}>
          {/* Company Logo or Name */}
          <View style={styles.coverLogo}>
            {company?.logo_url ? (
              <Image src={company.logo_url} style={styles.coverLogoImage} />
            ) : (
              <Text style={styles.coverLogoText}>{company?.name || 'Your Company'}</Text>
            )}
          </View>
          
          <Text style={styles.coverTitle}>ROOFING PROPOSAL</Text>
          <Text style={styles.coverSubtitle}>Professional Roofing Services</Text>
          
          {/* Decorative divider */}
          <View style={styles.coverDivider} />
          
          {/* Customer Info */}
          <Text style={styles.coverCustomer}>{proposal.customer_name}</Text>
          <Text style={styles.coverAddress}>{proposal.customer_address}</Text>
          
          {/* Price Box */}
          <View style={styles.coverPrice}>
            <Text style={styles.coverPriceLabel}>Your Investment</Text>
            <Text style={styles.coverPriceValue}>{formatCurrency(proposal.total)}</Text>
          </View>
          
          {/* Date */}
          <Text style={styles.coverDate}>
            Proposal Date: {formatDate(proposal.created_at)}
          </Text>
        </View>
      </Page>

      {/* Details Page */}
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.companyInfo}>
            <Text style={styles.companyName}>{company?.name || 'Your Company'}</Text>
            {company?.phone && <Text style={styles.companyDetail}>{company.phone}</Text>}
            {company?.email && <Text style={styles.companyDetail}>{company.email}</Text>}
            {company?.address && <Text style={styles.companyDetail}>{company.address}</Text>}
          </View>
          <View style={styles.proposalInfo}>
            <Text style={styles.proposalNumber}>{proposal.proposal_number}</Text>
            <Text style={styles.proposalDate}>{formatDate(proposal.created_at)}</Text>
          </View>
        </View>

        <View style={styles.content}>
          {/* Customer & Rep Info */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Project Details</Text>
            <View style={styles.customerGrid}>
              <View style={styles.customerColumn}>
                <Text style={styles.label}>Customer</Text>
                <Text style={styles.value}>{proposal.customer_name}</Text>
                <Text style={styles.label}>Property Address</Text>
                <Text style={styles.value}>{proposal.customer_address}</Text>
                {proposal.customer_phone && (
                  <>
                    <Text style={styles.label}>Phone</Text>
                    <Text style={styles.value}>{proposal.customer_phone}</Text>
                  </>
                )}
              </View>
              <View style={styles.customerColumn}>
                <Text style={styles.label}>Sales Representative</Text>
                <Text style={styles.value}>{rep?.full_name || 'N/A'}</Text>
                {rep?.phone && (
                  <>
                    <Text style={styles.label}>Rep Phone</Text>
                    <Text style={styles.value}>{rep.phone}</Text>
                  </>
                )}
                {rep?.email && (
                  <>
                    <Text style={styles.label}>Rep Email</Text>
                    <Text style={styles.value}>{rep.email}</Text>
                  </>
                )}
              </View>
            </View>
          </View>

          {/* Property Satellite Image */}
          {satelliteImageUrl && (
            <View style={styles.satelliteSection}>
              <Text style={styles.sectionTitle}>Property Location</Text>
              <Image src={satelliteImageUrl} style={styles.satelliteImage} />
              <Text style={styles.satelliteCaption}>{proposal.customer_address}</Text>
            </View>
          )}

          {/* Measurement Data */}
          {measurement && (
            <View style={styles.measurementBox}>
              <Text style={styles.measurementTitle}>Roof Measurements</Text>
              <View style={styles.measurementGrid}>
                <View style={styles.measurementItem}>
                  <Text style={styles.measurementValue}>{measurement.total_squares?.toFixed(1) || '-'}</Text>
                  <Text style={styles.measurementLabel}>Squares</Text>
                </View>
                <View style={styles.measurementItem}>
                  <Text style={styles.measurementValue}>{measurement.total_area_sqft?.toLocaleString() || '-'}</Text>
                  <Text style={styles.measurementLabel}>Sq Ft</Text>
                </View>
                <View style={styles.measurementItem}>
                  <Text style={styles.measurementValue}>{measurement.predominant_pitch || '-'}</Text>
                  <Text style={styles.measurementLabel}>Pitch</Text>
                </View>
                <View style={styles.measurementItem}>
                  <Text style={styles.measurementValue}>{measurement.facet_count || '-'}</Text>
                  <Text style={styles.measurementLabel}>Sections</Text>
                </View>
              </View>
            </View>
          )}

          {/* Scope of Work */}
          {proposal.scope_of_work && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Scope of Work</Text>
              <Text style={styles.scopeText}>{proposal.scope_of_work}</Text>
            </View>
          )}

          {/* Customer-Visible Line Items */}
          {lineItems.filter(item => item.show_to_customer).length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Project Details</Text>
              <View style={styles.table}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderCell, styles.col1]}>Description</Text>
                  <Text style={[styles.tableHeaderCell, styles.col2]}>Qty</Text>
                  <Text style={[styles.tableHeaderCell, styles.col3]}>Unit Price</Text>
                  <Text style={[styles.tableHeaderCell, styles.col4]}>Total</Text>
                </View>
                {lineItems.filter(item => item.show_to_customer).map((item, index) => (
                  <View key={item.id} style={[styles.tableRow, index % 2 === 1 ? styles.tableRowAlt : {}]}>
                    <View style={styles.col1}>
                      <Text style={styles.tableCellBold}>{item.name}</Text>
                      <Text style={[styles.tableCell, { fontSize: 8, color: '#94a3b8' }]}>{item.category}</Text>
                    </View>
                    <Text style={[styles.tableCell, styles.col2]}>{item.quantity} {item.unit}</Text>
                    <Text style={[styles.tableCell, styles.col3]}>{formatCurrency(item.unit_price)}</Text>
                    <Text style={[styles.tableCellBold, styles.col4]}>{formatCurrency(item.line_total)}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Investment Summary */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Investment Summary</Text>
            
            <View style={styles.totalsBox}>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Subtotal</Text>
                <Text style={styles.totalValue}>{formatCurrency(proposal.subtotal)}</Text>
              </View>
              {proposal.discount_amount > 0 && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Discount</Text>
                  <Text style={[styles.totalValue, { color: '#22c55e' }]}>-{formatCurrency(proposal.discount_amount)}</Text>
                </View>
              )}
              {proposal.tax_amount > 0 && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Tax ({proposal.tax_rate}%)</Text>
                  <Text style={styles.totalValue}>{formatCurrency(proposal.tax_amount)}</Text>
                </View>
              )}
              <View style={styles.grandTotalRow}>
                <Text style={styles.grandTotalLabel}>Total Investment</Text>
                <Text style={styles.grandTotalValue}>{formatCurrency(proposal.total)}</Text>
              </View>
            </View>
          </View>

          {/* Financing */}
          {proposal.financing_available && proposal.monthly_payment && (
            <View style={styles.financingBox}>
              <Text style={styles.financingTitle}>Financing Available</Text>
              <Text style={styles.financingAmount}>{formatCurrency(proposal.monthly_payment)}/month</Text>
              <Text style={styles.financingTerms}>
                {proposal.financing_term_months} months at {proposal.financing_rate}% APR
              </Text>
            </View>
          )}

          {/* Warranty */}
          {proposal.warranty_info && (
            <View style={[styles.section, { marginTop: 24 }]}>
              <View style={styles.warrantyBox}>
                <Text style={styles.warrantyTitle}>Warranty Information</Text>
                <Text style={styles.warrantyText}>{proposal.warranty_info}</Text>
              </View>
            </View>
          )}

          {/* Signature Section */}
          <View style={styles.signatureSection}>
            <Text style={[styles.sectionTitle, { borderBottomColor: '#1e293b' }]}>Authorization</Text>
            <View style={styles.signatureGrid}>
              <View style={styles.signatureBox}>
                <View style={styles.signatureLine} />
                <Text style={styles.signatureLabel}>Customer Signature</Text>
              </View>
              <View style={styles.signatureBox}>
                <View style={styles.signatureLine} />
                <Text style={styles.signatureLabel}>Date</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>{company?.name || 'Your Company'}</Text>
          <Text style={styles.footerText}>Proposal {proposal.proposal_number}</Text>
          <Text style={styles.footerText}>Page 2 of 2</Text>
        </View>
      </Page>
    </Document>
  )
}

export default ProposalPDF
