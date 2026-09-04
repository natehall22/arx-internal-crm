# Solar Permit Records Requests — NC Public Records Act

> **Local source audit:** [`scripts/solar-permits/README.md`](../scripts/solar-permits/README.md) (`npm run solar-permits:audit`) — Cabarrus ArcGIS/CAMA feasibility before ingest.

Template + per-county send list for the orphaned-solar campaign.
Feasibility review: https://claude.ai/code/artifact/c9130255-3b26-47bd-b358-cabd2aae4aeb

**Status:** drafted 2026-08-27, not yet sent.

---

## Before you send

**Do not scrape these portals.** Mecklenburg's permit domain publishes a robots.txt
naming ClaudeBot, GPTBot and CCBot with `ai-train=no`, and their code site 403s
automated requests. The request route below is the legal path and produces better
data anyway — counties retain permit records far longer than they publish online,
which is the only credible way to reach 2011.

**On stating purpose.** NC law does not require you to say why you want public
records, and this letter doesn't volunteer it — that's standard practice, not
evasion. If a county asks, answer honestly. Misrepresenting the purpose to a
records custodian would be a real problem; declining to volunteer what the statute
says is irrelevant is not.

**On GS 132-10.** If a county responds by offering a bulk database extract under a
use agreement barring "trade or commercial purposes," stop and route it to counsel
before signing. That's the one open legal question in this project.

**Cost control.** The letter asks for a written estimate before charges are
incurred. Don't skip that line — "special service charges" for extensive
extraction are permitted and unquantified.

---

## The letter

> **Subject:** Public Records Request — Solar/Photovoltaic Permits, 2011–Present
>
> To the Custodian of Public Records,
>
> Pursuant to the North Carolina Public Records Act, N.C. Gen. Stat. § 132-1 et seq.,
> I request copies of records for all solar and photovoltaic installation permits
> issued in [COUNTY] County from January 1, 2011 to the present.
>
> Where your permitting system classifies solar work under a dedicated record type,
> that type is the target of this request. Where it does not, I ask that the search
> cover building and electrical permits whose work description or scope references
> solar, photovoltaic, PV, or solar panel.
>
> For each responsive permit, I request the following fields:
>
> - Permit number and permit type
> - Date issued, and date of final inspection or completion if recorded
> - Project/site address, and parcel identification number (PIN)
> - Work description or scope of work
> - Contractor or installer name and license number
> - Permit valuation, if recorded
>
> **Format.** I request these records in an electronic, machine-readable format —
> CSV or Excel preferred, delimited text acceptable. If your system can export this
> directly, that is likely the least burdensome route for your staff. I do not need
> printed copies or scanned permit documents.
>
> **Three questions I'd appreciate answers to, whether or not records are produced:**
>
> 1. How far back do your retained permit records actually extend, and how far back
>    are they retrievable in electronic form? If 2011 is not reachable, I would still
>    like whatever range is available.
> 2. Does your office attach any use restrictions or require a written agreement for
>    records provided in bulk electronic form under N.C. Gen. Stat. § 132-10?
> 3. Is any of the requested field data withheld as confidential, and if so, under
>    what exemption?
>
> **Fees.** If fulfilling this request would involve a special service charge under
> § 132-6.2(b), please provide a written estimate before incurring any cost, and I
> will confirm or narrow the scope. I am glad to reduce the date range or field list
> if that materially lowers the burden.
>
> If any part of this request is unclear or the scope is impractical as written, I
> would welcome a call to narrow it to something your system can produce easily.
>
> Thank you for your time.
>
> Nathan Hall
> ARX Roofing & Exteriors
> nathan@arxroofing.com
> [PHONE]

---

## Send list

Verified 2026-08-27. **Prefer the records portal over the department email** — a
formal PRA request belongs with the records custodian, and all three portals below
were confirmed live. Department contacts are secondary.

### Cabarrus — send first ✅ fully verified on-page

- **Department:** Construction Standards — Matt Love, Director
- **Email:** `inspections@cabarruscounty.us` · Director direct: `tmlove@cabarruscounty.us`
- **Phone:** 704-920-2128 (Director 704-920-2131)
- **Mailing:** ⚠️ Offices are **temporarily relocated to 4855 Milestone Ave, Kannapolis**
  through early October 2026 for Government Center renovations. The usual 65 Church
  St S, Concord address will misroute mail right now — email instead.
- **Worth a look:** their site links a "Real-time Building Reports" tool that may
  offer a self-serve path. Check before filing the request.

### Mecklenburg ✅ portal verified (200)

- **Portal:** https://pi.mecknc.gov/Services/Public-Records-Requests
- **Email:** `publicinfo@mecknc.gov` · **Phone:** 980-314-2000
- **Records held by:** Land Use & Environmental Services (Code Enforcement)
- **Fees:** no charge to inspect; duplication at actual cost
- Note: an earlier lookup returned a bogus department address scraped from an
  obfuscated page. Use the Public Information Office channel above.

### Rowan ✅ portal verified (200)

- **Portal:** https://www.rowancountync.gov/642/Public-Records-Requests
- **Public records phone:** 704-216-8774
- **Mailing:** Rowan County Administration, 130 W Innes St, Suite 200, Salisbury, NC 28144
- **Building Inspections:** 704-216-8619 · 402 N Main St, Room 207, Salisbury
- **Fees:** uncertified copies $0.50/page

### Iredell ✅ portal verified (200)

- **Portal:** https://www.iredellcountync.gov/724/Request
- **Department:** Building Standards Division · 704-878-3113
- `buildingstandards-info@iredellcountync.gov` — *not independently confirmed, use the portal*
- **Good sign:** Iredell publishes a "Solar Panel Installation" guidance document,
  so solar is a recognized category in their system.

### ⚠️ Mooresville is a separate jurisdiction

Iredell's own site directs applicants to the **Town of Mooresville** for permits in
Mooresville and its ETJ. A request to Iredell County will likely miss Mooresville
entirely. That's a fifth request if we want that market — same municipal/county
split that made Gastonia a dead end in the research.

---

**Send Cabarrus first.** It's home turf, one Accela portal covers the county plus
Concord, Kannapolis and Harrisburg, and 84,193 Cabarrus parcels are already in
`canvass_parcel_years` keyed by PIN — the join exists today. If the pitch doesn't
convert in Concord, the other three counties are wasted engineering.

| County | Sent | Response | Depth confirmed | Use restriction? |
|---|---|---|---|---|
| Cabarrus | | | | |
| Mecklenburg | | | | |
| Rowan | | | | |
| Iredell | | | | |

---

## What to do with the response

Expect the depth answer to be the surprise. Mecklenburg may retain as little as
~6 years online; the whole "15 years" premise is unverified until a county puts it
in writing. If a county comes back with a shorter window than 2011, that's not a
failure — a 2016-forward list still finds ten-year-old arrays on original roofs.

Join permits to **current** tax records before mailing. The 2012 permit applicant
often isn't today's owner, and mailing the wrong name is a worse first impression
than mailing "Current Resident."
