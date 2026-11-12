/**
 * The copy-paste "Website form" for a lead source (Admin → Campaigns): a small self-contained HTML form + script that
 * posts JSON to the existing lead webhook with that source's token. Pure; client-safe.
 *
 * Fields: name, phone, email, address, service requested (a dropdown of the source's own choices, left out when none are
 * set), message. A hidden honeypot field (LEAD_FORM_HONEYPOT_FIELD) catches bots; the server rate-limits form posts.
 * Messages shown to the visitor are plain.
 */
import { LEAD_FORM_HONEYPOT_FIELD } from '@/lib/lead-intake'

export const LEAD_FORM_TEXT = {
  success: 'Thanks. We got your request and will be in touch soon.',
  error: 'Something went wrong. Please try again, or call us.',
  missing: 'Please enter your name and a phone number or email.',
  tooMany: 'Too many requests. Please try again in a few minutes.',
} as const

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
/** A value placed inside a <script> string: JSON, with `<` escaped so it can never close the tag. */
const js = (s: string) => JSON.stringify(s).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

export function buildLeadFormSnippet(opts: { endpoint: string; token: string; services: readonly string[] }): string {
  const url = `${opts.endpoint.replace(/\/+$/, '')}/api/webhooks/leads?token=${encodeURIComponent(opts.token)}`
  const field = 'display:block;width:100%;box-sizing:border-box;padding:10px;margin:0 0 12px;font:inherit;font-size:16px;border:1px solid #888;border-radius:6px;color:#111;background:#fff'
  const label = 'display:block;margin:0 0 4px;font-weight:600;color:#111'
  const services = opts.services.length
    ? `  <label style="${label}" for="lf-service">Service</label>
  <select id="lf-service" name="service_requested" style="${field}">
    <option value="">Choose a service</option>
${opts.services.map((s) => `    <option>${esc(s)}</option>`).join('\n')}
  </select>
`
    : ''
  return `<form id="lead-form" novalidate style="max-width:480px;font-family:inherit">
  <label style="${label}" for="lf-name">Name</label>
  <input id="lf-name" name="name" type="text" autocomplete="name" required style="${field}">
  <label style="${label}" for="lf-phone">Phone</label>
  <input id="lf-phone" name="phone" type="tel" autocomplete="tel" style="${field}">
  <label style="${label}" for="lf-email">Email</label>
  <input id="lf-email" name="email" type="email" autocomplete="email" style="${field}">
  <label style="${label}" for="lf-address">Address</label>
  <input id="lf-address" name="address" type="text" autocomplete="street-address" style="${field}">
${services}  <label style="${label}" for="lf-message">Message</label>
  <textarea id="lf-message" name="message" rows="4" style="${field}"></textarea>
  <div style="position:absolute;left:-9999px" aria-hidden="true"><input name="${LEAD_FORM_HONEYPOT_FIELD}" type="text" tabindex="-1" autocomplete="off" value=""></div>
  <button type="submit" style="padding:12px 20px;font:inherit;font-size:16px;font-weight:600;border:0;border-radius:6px;background:#111;color:#fff;cursor:pointer">Send</button>
  <p id="lead-form-note" role="status" style="margin:12px 0 0;color:#111"></p>
</form>
<script>
(function () {
  var form = document.getElementById('lead-form');
  var note = document.getElementById('lead-form-note');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var data = {};
    new FormData(form).forEach(function (v, k) { data[k] = String(v).trim(); });
    if (!data.name || (!data.phone && !data.email)) { note.textContent = ${js(LEAD_FORM_TEXT.missing)}; return; }
    var button = form.querySelector('button');
    button.disabled = true;
    note.textContent = '';
    fetch(${js(url)}, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) {
        if (r.ok) { form.reset(); note.textContent = ${js(LEAD_FORM_TEXT.success)}; }
        else { note.textContent = r.status === 429 ? ${js(LEAD_FORM_TEXT.tooMany)} : ${js(LEAD_FORM_TEXT.error)}; }
      })
      .catch(function () { note.textContent = ${js(LEAD_FORM_TEXT.error)}; })
      .then(function () { button.disabled = false; });
  });
})();
</script>`
}
