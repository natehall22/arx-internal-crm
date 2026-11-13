import { NextResponse } from 'next/server'

/** A generated PDF as a response: never cached, opens inline for printing (`download=1` saves it). */
export function pdfResponse(pdf: Buffer, filename: string, download = false): NextResponse {
  const safe = filename.replace(/[^A-Za-z0-9._ -]/g, '-')
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${safe}"`,
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
