import React from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: {
    padding: 32,
    fontSize: 11,
    fontFamily: 'Helvetica',
    color: '#111827',
  },
  section: {
    marginBottom: 12,
  },
  heading: {
    fontSize: 16,
    marginBottom: 8,
    fontWeight: 'bold',
  },
  label: {
    fontSize: 10,
    color: '#6b7280',
    marginBottom: 2,
  },
  value: {
    fontSize: 11,
  },
})

type AuditData = {
  orgName: string | null
  jobId: string
  contractId: string
  contractPath: string
  signedName: string | null
  signedEmail: string | null
  signedAt: string | null
  signedLocation: string | null
  signedIp: string | null
  signedUserAgent: string | null
}

export function ContractAuditPDF({ data }: { data: AuditData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.section}>
          <Text style={styles.heading}>Contract Audit Trail</Text>
          <Text style={styles.value}>
            {data.orgName ? data.orgName : 'Organization'} Contract Signature Record
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Project ID</Text>
          <Text style={styles.value}>{data.jobId}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Contract ID</Text>
          <Text style={styles.value}>{data.contractId}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Contract File</Text>
          <Text style={styles.value}>{data.contractPath}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Signed Name</Text>
          <Text style={styles.value}>{data.signedName || 'N/A'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Signed Email</Text>
          <Text style={styles.value}>{data.signedEmail || 'N/A'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Signed At</Text>
          <Text style={styles.value}>{data.signedAt || 'N/A'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Signing Location</Text>
          <Text style={styles.value}>{data.signedLocation || 'N/A'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Signing IP</Text>
          <Text style={styles.value}>{data.signedIp || 'N/A'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>User Agent</Text>
          <Text style={styles.value}>{data.signedUserAgent || 'N/A'}</Text>
        </View>
      </Page>
    </Document>
  )
}
