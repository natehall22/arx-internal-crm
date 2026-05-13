import React from 'react'
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer'
import { ARX_DEFAULT_OFFICE_ADDRESS } from '@/lib/company-address'

const styles = StyleSheet.create({
  page: { padding: 48, fontFamily: 'Helvetica', color: '#111827', backgroundColor: '#ffffff' },
  border: { flex: 1, border: '2 solid #1f2937', padding: 34 },
  header: { textAlign: 'center', marginBottom: 28, alignItems: 'center' },
  logo: { width: 116, height: 78, objectFit: 'contain', marginBottom: 10 },
  company: { fontSize: 18, fontWeight: 'bold', color: '#111827', marginBottom: 6 },
  companyMeta: { fontSize: 10, color: '#4b5563', lineHeight: 1.4 },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#0f172a',
    marginBottom: 8,
  },
  subtitle: { fontSize: 12, textAlign: 'center', color: '#475569', marginBottom: 32 },
  body: { fontSize: 13, lineHeight: 1.7, textAlign: 'center', marginBottom: 26 },
  details: { border: '1 solid #d1d5db', padding: 16, marginBottom: 30 },
  detailRow: {
    flexDirection: 'row',
    borderBottom: '1 solid #e5e7eb',
    paddingBottom: 8,
    marginBottom: 8,
  },
  detailRowLast: { flexDirection: 'row' },
  detailLabel: { width: '34%', fontSize: 10, color: '#6b7280', textTransform: 'uppercase' },
  detailValue: { width: '66%', fontSize: 12, color: '#111827', fontWeight: 'bold' },
  certification: { fontSize: 11, lineHeight: 1.6, color: '#374151', marginBottom: 34 },
  signatureSection: { marginTop: 'auto', flexDirection: 'row', justifyContent: 'space-between', gap: 24 },
  signatureBlock: { width: '46%' },
  signatureLine: { borderBottom: '1 solid #111827', height: 24, marginBottom: 7 },
  signatureLabel: { fontSize: 10, color: '#4b5563' },
  footer: {
    position: 'absolute',
    bottom: 22,
    left: 48,
    right: 48,
    textAlign: 'center',
    fontSize: 9,
    color: '#6b7280',
  },
})

export interface CompletionCertificatePDFProps {
  companyName: string
  companyAddress?: string | null
  companyPhone?: string | null
  companyEmail?: string | null
  logoSrc?: string | null
  jobNumber?: string | null
  customerName: string
  propertyAddress: string
  jobType?: string | null
  completionDate?: string | null
  generatedDate: string
}

function displayDate(value?: string | null) {
  if (!value) return 'Not recorded'
  const date = new Date(value.includes('T') ? value : `${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function titleCase(value?: string | null) {
  if (!value) return 'Exterior'
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function CompletionCertificatePDF({
  companyName,
  companyAddress,
  companyPhone,
  companyEmail,
  logoSrc,
  jobNumber,
  customerName,
  propertyAddress,
  jobType,
  completionDate,
  generatedDate,
}: CompletionCertificatePDFProps): React.ReactElement {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.border}>
          <View style={styles.header}>
            {logoSrc && <Image src={logoSrc} style={styles.logo} />}
            <Text style={styles.company}>{companyName}</Text>
            <Text style={styles.companyMeta}>
              {companyAddress || ARX_DEFAULT_OFFICE_ADDRESS}
              {companyPhone ? `\n${companyPhone}` : ''}
              {companyEmail ? ` | ${companyEmail}` : ''}
            </Text>
          </View>
          <Text style={styles.title}>Certificate of Completion</Text>
          <Text style={styles.subtitle}>Issued as confirmation of completed work</Text>
          <Text style={styles.body}>
            This certifies that {companyName} has completed the contracted {titleCase(jobType).toLowerCase()} work for
            the property listed below.
          </Text>
          <View style={styles.details}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Customer</Text>
              <Text style={styles.detailValue}>{customerName}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Property</Text>
              <Text style={styles.detailValue}>{propertyAddress}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Job Number</Text>
              <Text style={styles.detailValue}>{jobNumber || 'Not assigned'}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Completion Date</Text>
              <Text style={styles.detailValue}>{displayDate(completionDate)}</Text>
            </View>
            <View style={styles.detailRowLast}>
              <Text style={styles.detailLabel}>Work Type</Text>
              <Text style={styles.detailValue}>{titleCase(jobType)}</Text>
            </View>
          </View>
          <Text style={styles.certification}>
            Based on ARX Roofing & Exteriors records, the above referenced job has been marked complete in the
            operations system. This certificate is provided as confirmation of completion for the customer file,
            mortgage company, insurance carrier, or other party requiring proof that the contracted work is complete.
          </Text>
          <View style={styles.signatureSection}>
            <View style={styles.signatureBlock}>
              <View style={styles.signatureLine} />
              <Text style={styles.signatureLabel}>Authorized ARX Representative</Text>
            </View>
            <View style={styles.signatureBlock}>
              <View style={styles.signatureLine}>
                <Text>{displayDate(generatedDate)}</Text>
              </View>
              <Text style={styles.signatureLabel}>Date Issued</Text>
            </View>
          </View>
        </View>
        <Text style={styles.footer}>{companyName} | Certificate generated from ARX CRM</Text>
      </Page>
    </Document>
  )
}
