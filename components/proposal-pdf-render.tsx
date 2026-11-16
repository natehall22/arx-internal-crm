'use client'

/**
 * The ONE place a proposal PDF is rendered in the browser: the proposal page's download and the History "View PDF" both call
 * `renderProposalPdfBlob` with the same snapshot shape (`ProposalPdfSnapshot`, saved by lib/proposal-snapshots.ts), so a
 * rebuilt PDF comes from the same renderer and the same data as the one that was shown. Images are paths / URLs in the
 * snapshot; they are fetched into base64 here, only for the render (react-pdf embeds them reliably that way).
 */
import { pdf } from '@react-pdf/renderer'

import ProposalPDFv2, { type ProposalPDFData } from '@/components/ProposalPDFv2'
import type { ProposalPdfSnapshot } from '@/lib/proposal-snapshots'

async function imageUrlToBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export async function renderProposalPdfBlob(snapshot: ProposalPdfSnapshot): Promise<Blob> {
  const data = JSON.parse(JSON.stringify(snapshot.data)) as Record<string, any>
  const property = data.photos?.property
  if (typeof property === 'string' && property) {
    // The record never holds the Maps key: a satellite URL is stored without it and gets the browser key back here.
    const withKey = /^https:\/\/maps\.googleapis\.com\//.test(property) && !/[?&]key=/.test(property) ? `${property}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}` : property
    const b64 = await imageUrlToBase64(withKey)
    if (b64) data.photos.property = b64
    else if (data.photos) delete data.photos.property // skip the image rather than fail the PDF
  }
  // The dark theme prints on a dark page: use the logo made for dark backgrounds (the API sends the main logo's link when there is none).
  if (snapshot.theme === 'dark' && typeof data.company?.logo_dark_url === 'string' && data.company.logo_dark_url) data.company.logo_url = data.company.logo_dark_url
  if (data.company) delete data.company.logo_dark_url
  const logo = data.company?.logo_url
  if (typeof logo === 'string' && logo) {
    const b64 = await imageUrlToBase64(logo)
    // A relative /api/org-logo URL would make react-pdf fail the whole render; drop the logo instead.
    if (b64) data.company.logo_url = b64
    else delete data.company.logo_url
  }
  return pdf(<ProposalPDFv2 data={data as unknown as ProposalPDFData} theme={snapshot.theme} />).toBlob()
}
