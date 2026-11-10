import { loadLoginCompany } from '@/lib/company-login'

export const dynamic = 'force-dynamic'

export default async function PrivacyPolicy() {
  // The original company's wording only on an unfenced legacy address; otherwise this address's own company.
  const login = await loadLoginCompany()
  if (login.state !== 'legacy') {
    const company = login.state === 'company' ? login : null
    const who = company?.name || 'the company that uses it'
    return (
      <main style={{ maxWidth: 800, margin: '60px auto', padding: '20px' }}>
        <h1>Privacy Policy</h1>
        <p>Effective Date: February 6, 2026</p>
        <h2>Overview</h2>
        <p>This is an internal business platform used by {who} to manage customers, scheduling, and operations.</p>
        <h2>Information We Collect</h2>
        <p>We may collect names, email addresses, job information, and calendar event data necessary to operate our services.</p>
        <h2>Google User Data</h2>
        <p>
          If a user connects their Google account, this platform accesses Google Calendar data solely to create, view, or
          modify calendar events related to the company&apos;s business operations.
        </p>
        <p>We do not sell Google user data. We do not use Google data for advertising. We do not share Google data with third parties.</p>
        <h2>Data Storage</h2>
        <p>Data is securely stored using Supabase and Vercel infrastructure.</p>
        {company?.email ? (
          <>
            <h2>Contact</h2>
            <p>For privacy questions, contact: {company.email}</p>
          </>
        ) : null}
      </main>
    )
  }
  return (
    <main style={{ maxWidth: 800, margin: "60px auto", padding: "20px" }}>
      <h1>ARX CRM Privacy Policy</h1>
      <p>Effective Date: February 6, 2026</p>

      <h2>Overview</h2>
      <p>
        ARX CRM is an internal business platform used by ARX Roofing &amp; Exteriors
        to manage customers, scheduling, and operations.
      </p>

      <h2>Information We Collect</h2>
      <p>
        We may collect names, email addresses, job information, and calendar
        event data necessary to operate our services.
      </p>

      <h2>Google User Data</h2>
      <p>
        If a user connects their Google account, ARX CRM accesses Google Calendar
        data solely to create, view, or modify calendar events related to ARX business operations.
      </p>
      <p>
        We do not sell Google user data.
        We do not use Google data for advertising.
        We do not share Google data with third parties.
      </p>

      <h2>Data Storage</h2>
      <p>
        Data is securely stored using Supabase and Vercel infrastructure.
      </p>

      <h2>Contact</h2>
      <p>
        For privacy questions, contact: support@arxroofing.com
      </p>
    </main>
  );
}
