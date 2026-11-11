import { NextResponse } from 'next/server'

import { escapeHtml } from '@/lib/html'
import { isUsableCustomerEmail } from '@/lib/invoice-document'
import { getDocumentBrand } from '@/lib/org-brand'
import { getCrmEmailFrom, getMailTransport } from '@/lib/setter-email'
import { orgDb } from '@/lib/supabase/org-db'
import { requireOnlinePaymentsCaller } from '@/lib/online-payments/access'
import { loadOnlinePayments } from '@/lib/online-payments/accounts'
import { cardExpired, cardLabel, loadCardOnFile, removeCardOnFile, setAutopayOff } from '@/lib/online-payments/cards'
import { createPaymentLink } from '@/lib/online-payments/links'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

async function loadCustomer(admin: Parameters<typeof orgDb>[0], orgId: string, id: string) {
  const { data } = await orgDb(admin, orgId).from('customers').select('id, name, email').eq('id', id).maybeSingle()
  return data as { id: string; name: string | null; email: string | null } | null
}

async function view(admin: Parameters<typeof orgDb>[0], orgId: string, customerId: string) {
  const op = await loadOnlinePayments(admin, orgId)
  const card = await loadCardOnFile(admin, orgId, customerId)
  return {
    available: op.featureOn && op.ready && op.settings.autopay,
    featureOn: op.featureOn,
    card: card
      ? { label: cardLabel(card), autopay: card.autopay, expired: cardExpired(card, new Date()), expires: card.exp_month && card.exp_year ? `${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year).slice(-2)}` : null }
      : null,
  }
}

/** GET — the customer's card on file (brand / last 4 only) and whether autopay can be offered. Billing staff. */
export async function GET(_request: Request, { params }: Ctx) {
  const a = await requireOnlinePaymentsCaller('billing')
  if (a.error) return a.error
  if (!(await loadCustomer(a.admin, a.profile.org_id, params.id))) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  return NextResponse.json(await view(a.admin, a.profile.org_id, params.id))
}

/**
 * POST { email?: boolean } — a "save your card for automatic payments" link for this customer (the customer agrees and
 * enters the card on Stripe's page; the office never sees or types a card). Returns { url }; email: true sends it.
 */
export async function POST(request: Request, { params }: Ctx) {
  const a = await requireOnlinePaymentsCaller('billing')
  if (a.error) return a.error
  const orgId = a.profile.org_id
  const customer = await loadCustomer(a.admin, orgId, params.id)
  if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  const op = await loadOnlinePayments(a.admin, orgId)
  if (!op.featureOn) return NextResponse.json({ error: 'Online payments are off for this company' }, { status: 404 })
  if (!op.ready || !op.settings.autopay) return NextResponse.json({ error: 'Automatic payments are not available (Settings → Online payments)' }, { status: 409 })
  const link = await createPaymentLink(a.admin, orgId, { kind: 'save_card', customerId: customer.id }, a.profile.id)
  const body = (await request.json().catch(() => ({}))) as { email?: unknown }
  if (body.email !== true) return NextResponse.json({ url: link.url })
  if (!process.env.SMTP_HOST || !getCrmEmailFrom()) return NextResponse.json({ error: 'Email is not set up for this company yet', url: link.url }, { status: 503 })
  if (!isUsableCustomerEmail(customer.email)) return NextResponse.json({ error: 'This customer has no email address', url: link.url }, { status: 400 })
  const brand = await getDocumentBrand(a.admin, orgId)
  const lines = [
    `Hi ${customer.name || 'there'},`,
    `You can save a card with ${brand.casualName || brand.name} so your service invoices are paid automatically when they're sent.`,
    'It takes a minute, and your card is entered on Stripe’s secure page.',
  ]
  await getMailTransport().sendMail({
    from: getCrmEmailFrom(),
    to: customer.email as string,
    ...(brand.email ? { replyTo: brand.email } : {}),
    subject: `Automatic payments with ${brand.casualName || brand.name}`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#111827;">
  <div style="font-size:18px;font-weight:700;margin-bottom:12px;">${escapeHtml(brand.name)}</div>
  ${lines.map((l) => `<p style="font-size:15px;margin:0 0 10px;">${escapeHtml(l)}</p>`).join('')}
  <p style="margin:20px 0;"><a href="${escapeHtml(link.url)}" style="display:inline-block;background:#111827;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700;">Save my card</a></p>
  <p style="font-size:13px;color:#374151;">This link works for 14 days.</p>
</div>`,
    text: [...lines, '', `Save your card: ${link.url}`, 'This link works for 14 days.'].join('\n'),
  })
  return NextResponse.json({ url: link.url, emailedTo: customer.email })
}

/** PATCH { autopay: false } — stop automatic payments (turning them ON is only ever the customer's own choice). */
export async function PATCH(request: Request, { params }: Ctx) {
  const a = await requireOnlinePaymentsCaller('billing')
  if (a.error) return a.error
  if (!(await loadCustomer(a.admin, a.profile.org_id, params.id))) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  const body = (await request.json().catch(() => ({}))) as { autopay?: unknown }
  if (body.autopay !== false) return NextResponse.json({ error: 'Only the customer can turn automatic payments on (send them the save-card link)' }, { status: 400 })
  if (!(await setAutopayOff(a.admin, a.profile.org_id, params.id))) return NextResponse.json({ error: 'No card on file' }, { status: 404 })
  return NextResponse.json(await view(a.admin, a.profile.org_id, params.id))
}

/** DELETE — remove the card on file (detached at Stripe too). */
export async function DELETE(_request: Request, { params }: Ctx) {
  const a = await requireOnlinePaymentsCaller('billing')
  if (a.error) return a.error
  if (!(await loadCustomer(a.admin, a.profile.org_id, params.id))) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  if (!(await removeCardOnFile(a.admin, a.profile.org_id, params.id, a.profile.id))) return NextResponse.json({ error: 'No card on file' }, { status: 404 })
  return NextResponse.json(await view(a.admin, a.profile.org_id, params.id))
}
