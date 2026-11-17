# Company mail setup (Resend)

Other companies' email goes out from our product domain through Resend. ARX stays on its Gmail login, unchanged. Until these steps are done, other companies keep sending the old way (a warning is logged once).

## 1. Resend account
- Sign up at resend.com (use a company-owned login).
- Domains, then Add Domain. Use a sending subdomain such as `mail.<our product domain>` (keeps it apart from normal mail on the main domain).

## 2. DNS records
- Resend shows the exact records after you add the domain. Add each one at the DNS host for the product domain, exactly as shown:
  - SPF: a TXT (and an MX for bounces) on the `send` host
  - DKIM: a TXT named like `resend._domainkey`
- Click Verify in Resend. It can take a few minutes up to a few hours.
- DMARC (suggested, one TXT record): host `_dmarc.<sending domain>`, value `v=DMARC1; p=none; rua=mailto:<an inbox you read>`. Start with `p=none`, move to `quarantine` after a couple of weeks of clean reports.

## 3. API key
- Resend, API Keys, Create API Key, permission "Sending access", limited to the verified domain. Copy it once.
- Vercel, the project, Settings, Environment Variables, Production:
  - `RESEND_API_KEY` = the key
  - `COMPANY_MAIL_FROM_DOMAIN` = the verified sending domain (e.g. `mail.<our product domain>`, no `@`)
- Redeploy (env changes only apply to new deployments).

## 4. Test
- Sign in as a non-ARX company. Settings, Company settings: make sure Company name and Company email are filled in (replies go to that email).
- Send something to your own inbox (e.g. a password reset or a customer message to a test contact).
- In Gmail open the message, Show original: SPF, DKIM and DMARC should all say PASS, From should read `"<Company name>" <no-reply@<sending domain>>`, and hitting Reply should go to the company email.
- Also check the Resend dashboard, Emails: the message should be listed as Delivered.
- Send an invoice or a signed contract once too (those carry PDF attachments).

## Notes
- ARX (the original company), demo companies and mail with no company (public marketing forms) never use Resend.
- Remove either env var to go back to the old behavior immediately.
