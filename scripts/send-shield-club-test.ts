/**
 * Send a TEST of the ARX Shield Club marketing email through the CRM's SMTP sender.
 * Usage: npx tsx scripts/send-shield-club-test.ts [--dry-run]
 *
 * Recipients are hardcoded on purpose — this is a test send, not a campaign tool.
 * Images are hosted in the public `email-assets` bucket (kept for the real send).
 *
 * The CRM has no unsubscribe/suppression store yet, so the unsubscribe link here is a
 * mailto to info@. That is fine for a two-person test and NOT for a customer send.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServiceClient } from '../lib/supabase/service'
import { getCrmEmailFrom, getMailTransport } from '../lib/setter-email'

const RECIPIENTS = [
  { email: 'nathan@arxroofing.com', firstName: 'Nathan' },
  { email: 'steve@stewardbuildinggroup.com', firstName: 'Steve' },
]

const EMAIL_DIR = 'email/shield-club'
const BUCKET = 'email-assets'
const BUCKET_FOLDER = 'shield-club'
const IMAGES: { file: string; contentType: string }[] = [
  { file: 'hero.gif', contentType: 'image/gif' },
  { file: 'before-after.png', contentType: 'image/png' },
  { file: 'icon-clog.png', contentType: 'image/png' },
  { file: 'icon-calendar.png', contentType: 'image/png' },
  { file: 'icon-storm.png', contentType: 'image/png' },
  { file: 'icon-discount.png', contentType: 'image/png' },
]

const SIGNUP_LINK = 'https://arxroofing.com'
const UNSUBSCRIBE_MAILTO = 'mailto:info@arxroofing.com?subject=Unsubscribe'

function loadEnvLocal() {
  try {
    const envPath = resolve(process.cwd(), '.env.local')
    const raw = readFileSync(envPath, 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!(key in process.env)) {
        process.env[key] = value
      }
    }
  } catch {
    // .env.local optional when env is already exported
  }
}

async function hostImages(): Promise<string> {
  const supabase = createServiceClient()

  const { data: existing } = await supabase.storage.getBucket(BUCKET)
  if (!existing) {
    const { error } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: ['image/png', 'image/gif', 'image/jpeg', 'image/webp'],
    })
    if (error) throw new Error(`Create bucket failed: ${error.message}`)
    console.log(`Created public bucket ${BUCKET}`)
  } else if (!existing.public) {
    throw new Error(`Bucket ${BUCKET} exists but is not public`)
  }

  for (const image of IMAGES) {
    const body = readFileSync(resolve(process.cwd(), EMAIL_DIR, 'images', image.file))
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(`${BUCKET_FOLDER}/${image.file}`, body, {
        contentType: image.contentType,
        upsert: true,
      })
    if (error) throw new Error(`Upload ${image.file} failed: ${error.message}`)
  }

  const base = supabase.storage.from(BUCKET).getPublicUrl(BUCKET_FOLDER).data.publicUrl
  for (const image of IMAGES) {
    const res = await fetch(`${base}/${image.file}`, { method: 'HEAD' })
    const type = res.headers.get('content-type')
    console.log(`  ${res.status} ${type} ${base}/${image.file}`)
    if (res.status !== 200 || type !== image.contentType) {
      throw new Error(`Public URL check failed for ${image.file}`)
    }
  }
  return base
}

function fill(template: string, imgBase: string, firstName: string): string {
  const filled = template
    .replaceAll('{{IMG_BASE}}', imgBase)
    .replaceAll('{{first_name}}', firstName)
    .replaceAll('{{SIGNUP_LINK}}', SIGNUP_LINK)
    .replaceAll('{{UNSUBSCRIBE_LINK}}', UNSUBSCRIBE_MAILTO)
  const leftover = filled.match(/\{\{[^}]+\}\}/)
  if (leftover) throw new Error(`Unfilled placeholder ${leftover[0]}`)
  return filled
}

function htmlToText(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/i, '')
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>\s*<img[^>]*>\s*<\/a>/gi, '')
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, '').trim()
      return text ? `${text} (${href})` : ''
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|td|tr|table|p|li|h[1-6])>/gi, '\n')
    .replace(/<div\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/&rarr;/g, '→')
    .replace(/&mdash;/g, '—')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function main() {
  loadEnvLocal()
  const dryRun = process.argv.includes('--dry-run')

  const template = readFileSync(
    resolve(process.cwd(), EMAIL_DIR, 'arx-shield-club-email.html'),
    'utf8'
  ).replace(/^\s*<!--[\s\S]*?-->\s*/, '')

  console.log('Hosting images...')
  const imgBase = await hostImages()

  if (!dryRun && !process.env.SMTP_HOST) throw new Error('SMTP_HOST is not set')
  const transporter = dryRun ? null : getMailTransport()

  for (const recipient of RECIPIENTS) {
    const subject = `[TEST] ${recipient.firstName}, your gutters are about to fill up`
    const html = fill(template, imgBase, recipient.firstName)
    const text = htmlToText(html)

    if (!transporter) {
      const out = process.env.SHIELD_CLUB_DRY_RUN_DIR
      if (out) {
        writeFileSync(resolve(out, `${recipient.firstName}.html`), html)
        writeFileSync(resolve(out, `${recipient.firstName}.txt`), text)
      }
      console.log(`[dry run] ${recipient.email} — "${subject}" (${html.length} html / ${text.length} text chars)`)
      continue
    }

    try {
      // One message per recipient so neither address is exposed to the other.
      const info = await transporter.sendMail({
        from: getCrmEmailFrom(),
        to: recipient.email,
        subject,
        html,
        text,
        headers: { 'List-Unsubscribe': `<${UNSUBSCRIBE_MAILTO}>` },
      })
      const rejected = info.rejected.length ? ` REJECTED ${info.rejected.join(', ')}` : ''
      console.log(`sent ${recipient.email} — ${info.response} — ${info.messageId}${rejected}`)
    } catch (error) {
      console.log(`FAILED ${recipient.email} — ${error instanceof Error ? error.message : error}`)
      process.exitCode = 1
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
