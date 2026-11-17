'use client'

import * as React from 'react'

import { LEGACY_ANCHOR_HREFS } from '@/lib/settings-registry'

/** Old bookmarks and emails pointed at /admin#<card>; those cards now have their own pages. Keeps the query (?payments=, ?quickbooks=). */
export default function LegacyAnchorRedirect() {
  React.useEffect(() => {
    const slug = window.location.hash.replace(/^#/, '')
    const to = Object.prototype.hasOwnProperty.call(LEGACY_ANCHOR_HREFS, slug) ? LEGACY_ANCHOR_HREFS[slug] : null
    if (to) {
      const [path, hash] = to.split('#')
      window.location.replace(`${path}${window.location.search}#${hash}`)
    }
  }, [])
  return null
}
