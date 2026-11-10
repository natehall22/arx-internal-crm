import { loadLoginCompany } from '@/lib/company-login'

export const dynamic = 'force-dynamic'

export default async function TermsOfService() {
  // The original company's wording only on an unfenced legacy address; otherwise this address's own company.
  const login = await loadLoginCompany()
  if (login.state !== 'legacy') {
    const who = login.state === 'company' && login.name ? login.name : 'the company that gave you access'
    return (
      <main style={{ maxWidth: 800, margin: '60px auto', padding: '20px' }}>
        <h1>Terms of Service</h1>
        <p>This system is intended for authorized personnel of {who} only. Unauthorized access or use is prohibited.</p>
        <p>Use of this system implies acceptance of company policies and operational standards.</p>
      </main>
    )
  }
  return (
    <main style={{ maxWidth: 800, margin: "60px auto", padding: "20px" }}>
      <h1>ARX CRM Terms of Service</h1>

      <p>
        ARX CRM is intended for authorized ARX Roofing &amp; Exteriors personnel only.
        Unauthorized access or use is prohibited.
      </p>

      <p>
        Use of this system implies acceptance of company policies and operational standards.
      </p>
    </main>
  );
}
