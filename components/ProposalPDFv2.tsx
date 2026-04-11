'use client'

import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'

// ============================================================================
// DESIGN TOKEN SYSTEM
// ============================================================================

type Theme = 'dark' | 'print'

const tokens = {
  colors: {
    dark: {
      background: '#0F1012',
      cardBg: '#16181C',
      gold: '#C6A343',
      text: '#F3F4F6',
      textMuted: '#9CA3AF',
      border: '#2D2F33',
      accent: '#C6A343',
    },
    print: {
      background: '#FFFFFF',
      cardBg: '#F9FAFB',
      gold: '#C6A343',
      text: '#111827',
      textMuted: '#6B7280',
      border: '#E5E7EB',
      accent: '#111827',
    },
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  fontSize: {
    xs: 8,
    sm: 9,
    base: 10,
    md: 11,
    lg: 14,
    xl: 18,
    xxl: 24,
    hero: 36,
  },
  borderRadius: {
    sm: 4,
    md: 8,
    lg: 12,
  },
}

// ============================================================================
// DATA INTERFACES
// ============================================================================

export interface ProposalPDFData {
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
    scope_of_work?: string
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
    show_to_customer?: boolean
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
  financing?: {
    enabled: boolean
    type: 'cash' | 'financed'
    term_months?: number
    interest_rate?: number
    monthly_payment?: number
  }
  photos?: {
    property?: string
    inspection?: string[]
  }
  inspectionNotes?: string[]
}

interface ProposalPDFProps {
  data: ProposalPDFData
  theme?: Theme
}

const toCents = (value: number) => Math.round((Number(value) || 0) * 100)
const fromCents = (cents: number) => cents / 100

function getDisplayPricing(proposal: ProposalPDFData['proposal']) {
  const subtotalCents = toCents(proposal.subtotal || 0)
  let discountCents = proposal.discount_percent > 0
    ? Math.round(subtotalCents * ((proposal.discount_percent || 0) / 100))
    : toCents(proposal.discount_amount || 0)
  discountCents = Math.min(Math.max(discountCents, 0), subtotalCents)
  const afterDiscountCents = subtotalCents - discountCents
  const taxCents = Math.round(afterDiscountCents * ((proposal.tax_rate || 0) / 100))
  const totalCents = afterDiscountCents + taxCents

  return {
    subtotal: fromCents(subtotalCents),
    discountAmount: fromCents(discountCents),
    taxAmount: fromCents(taxCents),
    total: fromCents(totalCents),
  }
}

// ============================================================================
// STYLE FACTORY
// ============================================================================

const createStyles = (theme: Theme) => {
  const c = tokens.colors[theme]
  const s = tokens.spacing
  const f = tokens.fontSize
  const r = tokens.borderRadius

  return StyleSheet.create({
    // Base page
    page: {
      fontFamily: 'Helvetica',
      fontSize: f.base,
      backgroundColor: c.background,
      color: c.text,
      position: 'relative',
    },
    pageContent: {
      padding: s.xl,
      paddingBottom: 60,
    },

    // ========== COVER PAGE ==========
    coverPage: {
      flex: 1,
      padding: s.xxl,
      justifyContent: 'space-between',
      backgroundColor: c.background,
    },
    coverHeader: {
      alignItems: 'center',
      marginTop: s.xxl,
    },
    coverLogo: {
      maxWidth: 200,
      maxHeight: 70,
      marginBottom: s.lg,
    },
    coverLogoText: {
      fontSize: f.xl,
      fontFamily: 'Helvetica-Bold',
      color: c.text,
      letterSpacing: 3,
      textTransform: 'uppercase',
    },
    coverDivider: {
      width: 60,
      height: 2,
      backgroundColor: c.gold,
      marginTop: s.lg,
      marginBottom: s.lg,
    },
    coverTitle: {
      fontSize: f.hero,
      fontFamily: 'Helvetica-Bold',
      color: c.text,
      textAlign: 'center',
      marginTop: s.xxl,
    },
    coverSubtitle: {
      fontSize: f.lg,
      color: c.textMuted,
      textAlign: 'center',
      marginTop: s.sm,
    },
    coverMiddle: {
      alignItems: 'center',
      marginTop: s.xxl,
    },
    coverPreparedFor: {
      fontSize: f.sm,
      color: c.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 2,
      marginBottom: s.sm,
    },
    coverCustomerName: {
      fontSize: f.xxl,
      fontFamily: 'Helvetica-Bold',
      color: c.text,
      textAlign: 'center',
    },
    coverAddress: {
      fontSize: f.md,
      color: c.textMuted,
      textAlign: 'center',
      marginTop: s.xs,
    },
    coverFooter: {
      alignItems: 'center',
      marginBottom: s.xl,
    },
    coverRepInfo: {
      alignItems: 'center',
    },
    coverRepLabel: {
      fontSize: f.xs,
      color: c.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: s.xs,
    },
    coverRepName: {
      fontSize: f.lg,
      fontFamily: 'Helvetica-Bold',
      color: c.text,
    },
    coverRepPhone: {
      fontSize: f.base,
      color: c.textMuted,
      marginTop: 2,
    },
    coverWebsite: {
      fontSize: f.sm,
      color: c.gold,
      marginTop: s.lg,
    },

    // ========== SECTION HEADERS ==========
    sectionHeader: {
      marginBottom: s.lg,
      paddingBottom: s.sm,
      borderBottomWidth: 2,
      borderBottomColor: c.gold,
    },
    sectionTitle: {
      fontSize: f.xl,
      fontFamily: 'Helvetica-Bold',
      color: c.text,
    },
    sectionSubtitle: {
      fontSize: f.sm,
      color: c.textMuted,
      marginTop: 2,
    },

    // ========== INFO GRID ==========
    infoGrid: {
      flexDirection: 'row',
      gap: s.xl,
      marginBottom: s.lg,
    },
    infoColumn: {
      flex: 1,
    },
    infoLabel: {
      fontSize: f.xs,
      color: c.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 2,
    },
    infoValue: {
      fontSize: f.md,
      color: c.text,
      marginBottom: s.md,
    },

    // ========== STAT CARDS ==========
    statCardsRow: {
      flexDirection: 'row',
      gap: s.md,
      marginBottom: s.lg,
    },
    statCard: {
      flex: 1,
      backgroundColor: c.cardBg,
      borderRadius: r.md,
      padding: s.md,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: c.border,
    },
    statValue: {
      fontSize: f.xxl,
      fontFamily: 'Helvetica-Bold',
      color: c.gold,
    },
    statLabel: {
      fontSize: f.xs,
      color: c.textMuted,
      textTransform: 'uppercase',
      marginTop: s.xs,
    },

    // ========== PHOTO SECTIONS ==========
    heroImageBlock: {
      marginBottom: s.lg,
    },
    heroImage: {
      width: '100%',
      height: 180,
      objectFit: 'cover',
      borderRadius: r.md,
    },
    heroCaption: {
      fontSize: f.xs,
      color: c.textMuted,
      textAlign: 'center',
      marginTop: s.xs,
    },
    photoStrip: {
      flexDirection: 'row',
      gap: s.md,
      marginBottom: s.lg,
    },
    photoStripItem: {
      flex: 1,
    },
    photoStripImage: {
      width: '100%',
      height: 120,
      objectFit: 'cover',
      borderRadius: r.sm,
    },
    photoStripCaption: {
      fontSize: f.xs,
      color: c.textMuted,
      textAlign: 'center',
      marginTop: s.xs,
    },

    // ========== NOTES / BULLETS ==========
    bulletList: {
      marginBottom: s.lg,
    },
    bulletItem: {
      flexDirection: 'row',
      marginBottom: s.sm,
    },
    bulletDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: c.gold,
      marginRight: s.sm,
      marginTop: 4,
    },
    bulletText: {
      flex: 1,
      fontSize: f.base,
      color: c.text,
      lineHeight: 1.5,
    },

    // ========== PROCESS STEPS (Full Page Layout) ==========
    processPageContent: {
      flex: 1,
      padding: s.xl,
      paddingBottom: 60,
    },
    processGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: s.md,
      marginTop: s.lg,
    },
    processCard: {
      width: '48%',
      backgroundColor: c.cardBg,
      borderRadius: r.lg,
      padding: s.lg,
      borderWidth: 1,
      borderColor: c.border,
      minHeight: 140,
    },
    processCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: s.md,
    },
    stepNumber: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.gold,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: s.md,
    },
    stepNumberText: {
      fontSize: f.xl,
      fontFamily: 'Helvetica-Bold',
      color: theme === 'dark' ? '#0F1012' : '#FFFFFF',
    },
    stepTitle: {
      fontSize: f.lg,
      fontFamily: 'Helvetica-Bold',
      color: c.text,
      flex: 1,
    },
    stepDescription: {
      fontSize: f.base,
      color: c.textMuted,
      lineHeight: 1.6,
    },
    processTagline: {
      textAlign: 'center',
      marginTop: s.xl,
      paddingTop: s.lg,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    processTaglineText: {
      fontSize: f.lg,
      fontFamily: 'Helvetica-Bold',
      color: c.gold,
      marginBottom: s.xs,
    },
    processTaglineSubtext: {
      fontSize: f.sm,
      color: c.textMuted,
    },

    // ========== WARRANTY / WHY US ==========
    warrantyCard: {
      backgroundColor: c.cardBg,
      borderRadius: r.md,
      padding: s.lg,
      marginBottom: s.md,
      borderWidth: 1,
      borderColor: c.border,
    },
    warrantyTitle: {
      fontSize: f.lg,
      fontFamily: 'Helvetica-Bold',
      color: c.text,
      marginBottom: s.sm,
    },
    warrantyItem: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: s.sm,
    },
    warrantyIcon: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: c.gold,
      marginRight: s.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    warrantyIconText: {
      fontSize: 10,
      color: theme === 'dark' ? '#0F1012' : '#FFFFFF',
    },
    warrantyText: {
      fontSize: f.base,
      color: c.text,
    },
    whyUsItem: {
      marginBottom: s.md,
    },
    whyUsHeadline: {
      fontSize: f.md,
      fontFamily: 'Helvetica-Bold',
      color: c.text,
      marginBottom: 2,
    },
    whyUsDescription: {
      fontSize: f.sm,
      color: c.textMuted,
      lineHeight: 1.4,
    },

    // ========== PRICING ==========
    pricingSection: {
      marginTop: s.lg,
    },
    pricingCard: {
      backgroundColor: c.cardBg,
      borderRadius: r.md,
      padding: s.lg,
      borderWidth: 1,
      borderColor: c.border,
    },
    pricingRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: s.sm,
    },
    pricingLabel: {
      fontSize: f.base,
      color: c.textMuted,
    },
    pricingValue: {
      fontSize: f.base,
      color: c.text,
    },
    pricingDivider: {
      height: 1,
      backgroundColor: c.border,
      marginVertical: s.md,
    },
    pricingTotal: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    pricingTotalLabel: {
      fontSize: f.lg,
      fontFamily: 'Helvetica-Bold',
      color: c.text,
    },
    pricingTotalValue: {
      fontSize: f.xxl,
      fontFamily: 'Helvetica-Bold',
      color: c.gold,
    },
    financingBox: {
      backgroundColor: theme === 'dark' ? '#1E2328' : '#F0F9FF',
      borderRadius: r.md,
      padding: s.md,
      marginTop: s.lg,
      borderWidth: 1,
      borderColor: theme === 'dark' ? '#2D3748' : '#BAE6FD',
    },
    financingTitle: {
      fontSize: f.sm,
      color: c.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: s.xs,
    },
    financingAmount: {
      fontSize: f.xl,
      fontFamily: 'Helvetica-Bold',
      color: theme === 'dark' ? '#60A5FA' : '#1D4ED8',
    },
    financingTerms: {
      fontSize: f.xs,
      color: c.textMuted,
      marginTop: 2,
    },

    // ========== LINE ITEMS TABLE ==========
    table: {
      marginBottom: s.lg,
    },
    tableHeader: {
      flexDirection: 'row',
      backgroundColor: theme === 'dark' ? '#1E2328' : '#F3F4F6',
      padding: s.sm,
      borderRadius: r.sm,
      marginBottom: s.xs,
    },
    tableHeaderCell: {
      fontSize: f.xs,
      fontFamily: 'Helvetica-Bold',
      color: c.textMuted,
      textTransform: 'uppercase',
    },
    tableRow: {
      flexDirection: 'row',
      padding: s.sm,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    tableCell: {
      fontSize: f.sm,
      color: c.text,
    },
    tableCellBold: {
      fontSize: f.sm,
      fontFamily: 'Helvetica-Bold',
      color: c.text,
    },
    col1: { width: '50%' },
    col2: { width: '15%', textAlign: 'right' },
    col3: { width: '17%', textAlign: 'right' },
    col4: { width: '18%', textAlign: 'right' },

    // ========== SIGNATURE ==========
    signatureSection: {
      marginTop: s.xl,
    },
    signatureGrid: {
      flexDirection: 'row',
      gap: s.xl,
    },
    signatureBox: {
      flex: 1,
    },
    signatureLine: {
      borderBottomWidth: 1,
      borderBottomColor: c.text,
      marginBottom: s.sm,
      height: 40,
    },
    signatureLabel: {
      fontSize: f.xs,
      color: c.textMuted,
    },

    // ========== FOOTER ==========
    footer: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      padding: s.md,
      paddingHorizontal: s.xl,
      backgroundColor: c.cardBg,
      borderTopWidth: 1,
      borderTopColor: c.border,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    footerText: {
      fontSize: f.xs,
      color: c.textMuted,
    },

    // ========== DISCLAIMER ==========
    disclaimer: {
      marginTop: s.lg,
      padding: s.md,
      backgroundColor: c.cardBg,
      borderRadius: r.sm,
      borderWidth: 1,
      borderColor: c.border,
    },
    disclaimerText: {
      fontSize: f.xs,
      color: c.textMuted,
      fontStyle: 'italic',
      textAlign: 'center',
    },
  })
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// ============================================================================
// STATIC CONTENT
// ============================================================================

const processSteps = [
  {
    title: 'Initial Consultation',
    description: 'We assess your roof, discuss your needs, and provide a detailed proposal.',
  },
  {
    title: 'Material Selection',
    description: 'Choose from premium roofing materials that fit your style and budget.',
  },
  {
    title: 'Project Scheduling',
    description: 'We coordinate a convenient installation date that works for you.',
  },
  {
    title: 'Professional Installation',
    description: 'Our certified crew completes your roof with precision and care.',
  },
  {
    title: 'Quality Inspection',
    description: 'We perform a thorough walkthrough to ensure everything meets our standards.',
  },
  {
    title: 'Final Cleanup & Warranty',
    description: 'We leave your property clean and provide all warranty documentation.',
  },
]

const warranties = [
  { text: '5-Year Workmanship Warranty' },
  { text: '1-Year No-Leak Guarantee' },
  { text: '25-Year Manufacturer Warranty' },
  { text: '6-Month Post-Installation Checkup' },
  { text: '12-Month Roof Inspection' },
]

const whyUsPoints = [
  {
    headline: 'Local & Long-Term',
    description: 'We are Charlotte-based and committed to serving our community for years to come.',
  },
  {
    headline: 'Complete Roofing Systems',
    description: 'We install full roofing systems—not patchwork fixes—built for long-term performance.',
  },
  {
    headline: 'Clear Communication',
    description: 'Every project is documented with photos and written scopes. You always know what to expect.',
  },
  {
    headline: 'Professional Process',
    description: 'Clean job sites, final walkthroughs, and a step-by-step approach from start to finish.',
  },
  {
    headline: 'Insurance Guidance',
    description: 'We help navigate the claims process without overpromising outcomes.',
  },
]

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const ProposalPDFv2 = ({ data, theme = 'print' }: ProposalPDFProps) => {
  const styles = createStyles(theme)
  const { proposal, lineItems, measurement, company, rep, financing, photos, inspectionNotes } = data
  const displayPricing = getDisplayPricing(proposal)

  const hasPhotos = photos?.inspection && photos.inspection.length > 0
  const hasAdders = lineItems.filter(i => i.is_adder && i.show_to_customer).length > 0
  const visibleLineItems = lineItems.filter(i => i.show_to_customer && !i.is_adder)
  const visibleAdders = lineItems.filter(i => i.is_adder && i.show_to_customer)

  // Calculate page numbers dynamically
  let currentPage = 1
  const totalPages = hasPhotos ? 7 : 6

  return (
    <Document>
      {/* ================================================================
          PAGE 1: COVER PAGE
          ================================================================ */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.coverPage}>
          {/* Header with Logo */}
          <View style={styles.coverHeader}>
            {company?.logo_url ? (
              <Image src={company.logo_url} style={styles.coverLogo} />
            ) : (
              <Text style={styles.coverLogoText}>{company?.name || 'ARX Roofing & Exteriors'}</Text>
            )}
            <View style={styles.coverDivider} />
          </View>

          {/* Title */}
          <View style={styles.coverMiddle}>
            <Text style={styles.coverTitle}>ROOFING PROPOSAL</Text>
            <Text style={styles.coverSubtitle}>Professional Roofing Services</Text>
            
            <View style={{ marginTop: tokens.spacing.xxl }}>
              <Text style={styles.coverPreparedFor}>Prepared For</Text>
              <Text style={styles.coverCustomerName}>{proposal.customer_name}</Text>
              <Text style={styles.coverAddress}>{proposal.customer_address}</Text>
            </View>
          </View>

          {/* Footer with Rep Info */}
          <View style={styles.coverFooter}>
            <View style={styles.coverRepInfo}>
              <Text style={styles.coverRepLabel}>Your Representative</Text>
              <Text style={styles.coverRepName}>{rep?.full_name || 'Sales Representative'}</Text>
              {rep?.phone && <Text style={styles.coverRepPhone}>{rep.phone}</Text>}
            </View>
            {company?.website && (
              <Text style={styles.coverWebsite}>{company.website}</Text>
            )}
          </View>
        </View>
      </Page>

      {/* ================================================================
          PAGE 2: PROJECT DETAILS
          ================================================================ */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.pageContent}>
          {/* Section Header */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Project Details</Text>
            <Text style={styles.sectionSubtitle}>Property information and roof measurements</Text>
          </View>

          {/* Property Info */}
          <View style={styles.infoGrid}>
            <View style={styles.infoColumn}>
              <Text style={styles.infoLabel}>Property Address</Text>
              <Text style={styles.infoValue}>{proposal.customer_address}</Text>
              
              <Text style={styles.infoLabel}>Customer</Text>
              <Text style={styles.infoValue}>{proposal.customer_name}</Text>
              
              {proposal.customer_phone && (
                <>
                  <Text style={styles.infoLabel}>Phone</Text>
                  <Text style={styles.infoValue}>{proposal.customer_phone}</Text>
                </>
              )}
            </View>
            <View style={styles.infoColumn}>
              <Text style={styles.infoLabel}>Proposal Number</Text>
              <Text style={styles.infoValue}>{proposal.proposal_number}</Text>
              
              <Text style={styles.infoLabel}>Date</Text>
              <Text style={styles.infoValue}>{formatDate(proposal.created_at)}</Text>
              
              <Text style={styles.infoLabel}>Representative</Text>
              <Text style={styles.infoValue}>{rep?.full_name || 'N/A'}</Text>
            </View>
          </View>

          {/* Property Image */}
          {photos?.property && (
            <View style={styles.heroImageBlock}>
              <Image src={photos.property} style={styles.heroImage} />
              <Text style={styles.heroCaption}>Property Location</Text>
            </View>
          )}

          {/* Roof Measurements */}
          {measurement && (
            <>
              <View style={[styles.sectionHeader, { marginTop: tokens.spacing.lg }]}>
                <Text style={styles.sectionTitle}>Roof Measurements</Text>
              </View>
              <View style={styles.statCardsRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{measurement.total_squares?.toFixed(1) || '—'}</Text>
                  <Text style={styles.statLabel}>Squares</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{measurement.total_area_sqft?.toLocaleString() || '—'}</Text>
                  <Text style={styles.statLabel}>Sq Ft</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{measurement.predominant_pitch || '—'}</Text>
                  <Text style={styles.statLabel}>Pitch</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{measurement.facet_count || '—'}</Text>
                  <Text style={styles.statLabel}>Sections</Text>
                </View>
              </View>
            </>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>{company?.name || 'ARX Roofing & Exteriors'}</Text>
          <Text style={styles.footerText}>{proposal.proposal_number}</Text>
          <Text style={styles.footerText}>Page 2 of {totalPages}</Text>
        </View>
      </Page>

      {/* ================================================================
          PAGE 3: SCOPE OF WORK & INSPECTION NOTES
          ================================================================ */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.pageContent}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Scope of Work</Text>
            <Text style={styles.sectionSubtitle}>What we found and what we'll do</Text>
          </View>

          {/* Scope of Work */}
          {proposal.scope_of_work && (
            <View style={{ marginBottom: tokens.spacing.lg }}>
              <Text style={{ fontSize: tokens.fontSize.base, color: tokens.colors[theme].text, lineHeight: 1.6 }}>
                {proposal.scope_of_work}
              </Text>
            </View>
          )}

          {/* Inspection Notes */}
          {inspectionNotes && inspectionNotes.length > 0 && (
            <>
              <View style={[styles.sectionHeader, { marginTop: tokens.spacing.md }]}>
                <Text style={styles.sectionTitle}>Inspection Findings</Text>
              </View>
              <View style={styles.bulletList}>
                {inspectionNotes.map((note, index) => (
                  <View key={index} style={styles.bulletItem}>
                    <View style={styles.bulletDot} />
                    <Text style={styles.bulletText}>{note}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Line Items if showing to customer */}
          {visibleLineItems.length > 0 && (
            <>
              <View style={[styles.sectionHeader, { marginTop: tokens.spacing.md }]}>
                <Text style={styles.sectionTitle}>Project Includes</Text>
              </View>
              <View style={styles.table}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderCell, styles.col1]}>Description</Text>
                  <Text style={[styles.tableHeaderCell, styles.col2]}>Qty</Text>
                  <Text style={[styles.tableHeaderCell, styles.col3]}>Unit</Text>
                  <Text style={[styles.tableHeaderCell, styles.col4]}>Total</Text>
                </View>
                {visibleLineItems.map((item) => (
                  <View key={item.id} style={styles.tableRow}>
                    <Text style={[styles.tableCellBold, styles.col1]}>{item.name}</Text>
                    <Text style={[styles.tableCell, styles.col2]}>{item.quantity}</Text>
                    <Text style={[styles.tableCell, styles.col3]}>{item.unit}</Text>
                    <Text style={[styles.tableCellBold, styles.col4]}>{formatCurrency(item.line_total)}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>{company?.name || 'ARX Roofing & Exteriors'}</Text>
          <Text style={styles.footerText}>{proposal.proposal_number}</Text>
          <Text style={styles.footerText}>Page 3 of {totalPages}</Text>
        </View>
      </Page>

      {/* ================================================================
          PAGE 4 (CONDITIONAL): INSPECTION PHOTOS
          ================================================================ */}
      {hasPhotos && (
        <Page size="LETTER" style={styles.page}>
          <View style={styles.pageContent}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Inspection Photos</Text>
              <Text style={styles.sectionSubtitle}>Documentation from our roof assessment</Text>
            </View>

            <View style={styles.photoStrip}>
              {photos!.inspection!.slice(0, 3).map((url, index) => (
                <View key={index} style={styles.photoStripItem}>
                  <Image src={url} style={styles.photoStripImage} />
                  <Text style={styles.photoStripCaption}>Photo {index + 1}</Text>
                </View>
              ))}
            </View>

            {/* If more than 3 photos, show additional row */}
            {photos!.inspection!.length > 3 && (
              <View style={styles.photoStrip}>
                {photos!.inspection!.slice(3, 6).map((url, index) => (
                  <View key={index} style={styles.photoStripItem}>
                    <Image src={url} style={styles.photoStripImage} />
                    <Text style={styles.photoStripCaption}>Photo {index + 4}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>{company?.name || 'ARX Roofing & Exteriors'}</Text>
            <Text style={styles.footerText}>{proposal.proposal_number}</Text>
            <Text style={styles.footerText}>Page 4 of {totalPages}</Text>
          </View>
        </Page>
      )}

      {/* ================================================================
          PAGE 4/5: THE PROCESS (Full Page Marketing Layout)
          ================================================================ */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.processPageContent}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>The Process</Text>
            <Text style={styles.sectionSubtitle}>Your roof replacement from start to finish</Text>
          </View>

          {/* 2x3 Grid of Process Cards */}
          <View style={styles.processGrid}>
            {processSteps.map((step, index) => (
              <View key={index} style={styles.processCard}>
                <View style={styles.processCardHeader}>
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>{index + 1}</Text>
                  </View>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                </View>
                <Text style={styles.stepDescription}>{step.description}</Text>
              </View>
            ))}
          </View>

          {/* Bottom Tagline */}
          <View style={styles.processTagline}>
            <Text style={styles.processTaglineText}>Professional Service, Start to Finish</Text>
            <Text style={styles.processTaglineSubtext}>
              Every project follows our proven process to ensure quality results and complete satisfaction.
            </Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>{company?.name || 'ARX Roofing & Exteriors'}</Text>
          <Text style={styles.footerText}>{proposal.proposal_number}</Text>
          <Text style={styles.footerText}>Page {hasPhotos ? 5 : 4} of {totalPages}</Text>
        </View>
      </Page>

      {/* ================================================================
          PAGE 5/6: WARRANTIES & WHY ARX
          ================================================================ */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.pageContent}>
          {/* Warranties */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Our Warranties</Text>
            <Text style={styles.sectionSubtitle}>Your investment is protected</Text>
          </View>

          <View style={styles.warrantyCard}>
            {warranties.map((warranty, index) => (
              <View key={index} style={styles.warrantyItem}>
                <View style={styles.warrantyIcon}>
                  <Text style={styles.warrantyIconText}>✓</Text>
                </View>
                <Text style={styles.warrantyText}>{warranty.text}</Text>
              </View>
            ))}
          </View>

          {/* Why ARX */}
          <View style={[styles.sectionHeader, { marginTop: tokens.spacing.xl }]}>
            <Text style={styles.sectionTitle}>Why Homeowners Choose ARX</Text>
          </View>

          {whyUsPoints.map((point, index) => (
            <View key={index} style={styles.whyUsItem}>
              <Text style={styles.whyUsHeadline}>{point.headline}</Text>
              <Text style={styles.whyUsDescription}>{point.description}</Text>
            </View>
          ))}

          {/* Disclaimer */}
          <View style={styles.disclaimer}>
            <Text style={styles.disclaimerText}>
              Insurance coverage decisions are made by the carrier. ARX can assist throughout the process.
            </Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>{company?.name || 'ARX Roofing & Exteriors'}</Text>
          <Text style={styles.footerText}>{proposal.proposal_number}</Text>
          <Text style={styles.footerText}>Page {hasPhotos ? 6 : 5} of {totalPages}</Text>
        </View>
      </Page>

      {/* ================================================================
          PAGE 6/7: PRICING & AUTHORIZATION
          ================================================================ */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.pageContent}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Your Investment</Text>
            <Text style={styles.sectionSubtitle}>Project pricing and authorization</Text>
          </View>

          {/* Pricing Card */}
          <View style={styles.pricingCard}>
            <View style={styles.pricingRow}>
              <Text style={styles.pricingLabel}>Subtotal</Text>
              <Text style={styles.pricingValue}>{formatCurrency(displayPricing.subtotal)}</Text>
            </View>

            {displayPricing.discountAmount > 0 && (
              <View style={styles.pricingRow}>
                <Text style={styles.pricingLabel}>Discount</Text>
                <Text style={[styles.pricingValue, { color: '#22C55E' }]}>
                  -{formatCurrency(displayPricing.discountAmount)}
                </Text>
              </View>
            )}

            <View style={styles.pricingRow}>
              <Text style={styles.pricingLabel}>Tax ({proposal.tax_rate}%)</Text>
              <Text style={styles.pricingValue}>{formatCurrency(displayPricing.taxAmount)}</Text>
            </View>

            <View style={styles.pricingDivider} />

            <View style={styles.pricingTotal}>
              <Text style={styles.pricingTotalLabel}>Total Investment</Text>
              <Text style={styles.pricingTotalValue}>{formatCurrency(displayPricing.total)}</Text>
            </View>
          </View>

          {/* Adders */}
          {hasAdders && (
            <>
              <View style={[styles.sectionHeader, { marginTop: tokens.spacing.lg }]}>
                <Text style={styles.sectionTitle}>Additional Items</Text>
              </View>
              <View style={styles.table}>
                {visibleAdders.map((item) => (
                  <View key={item.id} style={styles.tableRow}>
                    <Text style={[styles.tableCellBold, { width: '70%' }]}>{item.name}</Text>
                    <Text style={[styles.tableCellBold, { width: '30%', textAlign: 'right' }]}>
                      {formatCurrency(item.line_total)}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Financing */}
          {financing?.enabled && financing.type === 'financed' && financing.monthly_payment && (
            <View style={styles.financingBox}>
              <Text style={styles.financingTitle}>Monthly Payment Option</Text>
              <Text style={styles.financingAmount}>
                {formatCurrency(financing.monthly_payment)}/month
              </Text>
              <Text style={styles.financingTerms}>
                {financing.term_months} months at {financing.interest_rate}% APR
              </Text>
            </View>
          )}

          {/* Signature Section */}
          <View style={styles.signatureSection}>
            <View style={[styles.sectionHeader, { borderBottomColor: tokens.colors[theme].text }]}>
              <Text style={styles.sectionTitle}>Authorization</Text>
            </View>
            <Text style={{ fontSize: tokens.fontSize.sm, color: tokens.colors[theme].textMuted, marginBottom: tokens.spacing.md }}>
              By signing below, I authorize {company?.name || 'ARX Roofing & Exteriors'} to proceed with the work described in this proposal.
            </Text>
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
            <View style={[styles.signatureGrid, { marginTop: tokens.spacing.lg }]}>
              <View style={styles.signatureBox}>
                <View style={styles.signatureLine} />
                <Text style={styles.signatureLabel}>Print Name</Text>
              </View>
              <View style={styles.signatureBox}>
                <View style={styles.signatureLine} />
                <Text style={styles.signatureLabel}>Phone</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>{company?.name || 'ARX Roofing & Exteriors'}</Text>
          <Text style={styles.footerText}>{proposal.proposal_number}</Text>
          <Text style={styles.footerText}>Page {totalPages} of {totalPages}</Text>
        </View>
      </Page>
    </Document>
  )
}

export default ProposalPDFv2
