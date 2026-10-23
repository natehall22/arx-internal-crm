# Supplier Integrations Spec: Live Pricing and Ordering

**For:** ARX Roofing & Exteriors CRM (Supabase), designed so other trades and companies can use it later
**Status:** Research and design only. No code or database was changed.
**Research date:** 2026-10-21. Supplier programs change often, so check every claim with the supplier before building against it.
**Related build:** "CRM emails the order sheet" (PDF purchase order by email). This spec treats it as the universal fallback connector.

---

## Part A. Plain-English summary for the owner

**What this lets you do.** When you build a proposal, the CRM can show what your own supplier account actually pays for each item (your negotiated price, not the list price). When the job sells, the CRM turns the proposal into a purchase order (PO). A person reviews and confirms it. Then the CRM either sends it straight to the supplier's system or emails the PDF order sheet, as it will today. Order status and invoices come back to the job. Every dollar ends up in one job-cost ledger and later becomes a QuickBooks bill.

**What the research found.**

1. **QXO is Beacon.** QXO completed its $11B purchase of Beacon in April 2025. QXO's strategy chief said, "We rebranded to QXO on day one": the website, app and branch signs. Software partners now list the integration as "QXO". Old Beacon links (becn.com) redirect to qxo.com, and the old "Beacon PRO+" login still shows up in some help articles. QXO has also kept buying companies: Kodiak closed in April 2026, and a TopBuild deal was pending as of April 2026. Expect more catalog and branch changes.
2. **QXO connects to many roofing CRMs.** The list includes AccuLynx, JobNimbus, Leap, Roofr, Hover, ServiceTitan, JobTread and Proline. Those integrations already do your account pricing, ordering, status and delivery photos. **QXO has no public self-serve developer portal.** It has an "API Services" contact page. Getting access means contacting QXO and asking, and that is the first thing you need to do.
3. **ABC Supply has the most open program.** It has a published developer portal, a sandbox (test system) and two tracks. One is for a single business connecting its own account, which fits ARX today. The other is for software platforms serving many contractors, which fits if other companies use the CRM. Its terms **forbid using its data to build price-comparison tools.** That limits the "best price across suppliers" feature (see C.4).
4. **SRS (owned by Home Depot) connects per contractor.** Each contractor gets an "Integration Key" from their Roof Hub account. SRS works with Roofr, JobNimbus, Leap, RoofLink and ServiceTitan. No public developer program turned up, so SRS likely needs a partner agreement.
5. **Gulfeagle** has an app (Gulfeagle Advantage) but no API or CRM integration turned up. Treat it as email-only.
6. **Home Depot and Lowe's** offer "punchout" for business buyers: you shop their site from inside your system and the cart comes back. Setup needs a rep. One procurement tool says Home Depot requires at least **$50k per year in spend** to connect. Low priority.
7. **Electrical and plumbing distributors** (Graybar, Wesco, CED, Rexel, Ferguson) mostly work through **EDI** (an older standard for exchanging electronic business documents), punchout, or deals with big field-service platforms such as ServiceTitan and Simpro. Ferguson syncs account pricing nightly into ServiceTitan. Aggregators such as Remarcable claim connections to 150+ MEP (mechanical, electrical, plumbing) suppliers, at custom pricing. For those trades, email-PDF ordering plus invoice capture is the realistic start.

**The safety promise (your priority).** The CRM will **never place an order by itself.** An order only goes out after a person with the right role opens a review screen with totals and delivery details and clicks Confirm. Large orders can require a second person. Automations, scheduled jobs and the AI cannot submit orders; the system blocks them by design. Every order has a unique PO number, so a double-click or a retry cannot create two orders. The CRM warns you if the same job already ordered the same items recently. There's a short "oops" window before sending, an off switch per company, a test mode per supplier, and a full log of who did what.

**Two or more suppliers.** Each company sets a default supplier per trade and category, for example "Roofing shingles: QXO" and "Gutters: ABC". A job or a single line can override the default. A mixed order is split into one PO per supplier automatically, and each PO goes out its own way (API to one, email to another). Price comparison across suppliers is a suggestion only. It's limited to suppliers whose terms allow it, and a person always picks.

**Not everything is bought from a supplier.** Every material line has a **material source**:
- **Supplier-bought:** goes on a PO.
- **Installer-supplied:** the sub brings it and bills you.
- **Customer-supplied:** the homeowner provides it, so no cost.
- **Own stock:** pulled from your shop.

Each company sets defaults per trade. The job can change them. Each source flows to job costs and QuickBooks differently (see C.5).

**What you need to do.** See Part D, "Owner actions":
- Contact QXO API Services.
- Sign up for the ABC developer portal (only if you use or might use ABC).
- Get your SRS Roof Hub Integration Key (only if you use SRS).
- Collect the account, ship-to and branch numbers for each supplier.
- Decide the approval threshold and who can approve.

---

## Part B. Research findings (with sources)

Confidence levels: **High** means a first-party doc. **Med** means a partner or press source. **Low** means a third-party listing or inference.

### B.1 QXO (formerly Beacon Building Products / Beacon Roofing Supply)

| Topic | Finding | Confidence / source |
|---|---|---|
| Ownership | Deal agreed March 2025, about $11B all cash. Beacon delisted from NASDAQ on 2025-04-29. | High: [Wikipedia](https://en.wikipedia.org/wiki/Beacon_Building_Products), [MDM](https://www.mdm.com/news/top-distributor-sectors/building-materials-construction/done-deal-qxo-completes-11b-purchase-of-beacon/) |
| Naming | QXO CSO Matt Fassler: "We rebranded to QXO on day one", covering e-commerce, the customer app and branch signage. becn.com/integrations and go.becn.com/beaconapi now 302-redirect to qxo.com. Hover's help article still says to connect your "Beacon PRO+" account and warns that you "may still see older Beacon logos." | Med: [RoofersCoffeeShop](https://www.rooferscoffeeshop.com/post/qxos-roadmap-for-the-next-chapter); High: redirects observed 2026-10-21; [Hover](https://help.hover.to/en/articles/8417806-submit-orders-directly-to-qxo-from-hover) |
| Contractor portal | "QXO online" / QXO app: real-time inventory and pricing, order templates, delivery tracking with photos, 5 years of invoices, BillTrust bill pay, rebate tracking, and invoice download to QuickBooks or Peachtree. | Med: [preview.becn.com/qxo-app](https://preview.becn.com/qxo-app) |
| API | The "API Services" page says businesses can "connect to Beacon APIs to place and track orders" from their PM software, via "Contact us". It gives no public docs, formats or pricing. A third-party catalog (APIs.io) lists a "Beacon PRO+" API covering catalog, real-time inventory and pricing, orders, delivery tracking, account and rebates, documented in OpenAPI/Swagger. That spec was not verified. | High (existence): [qxo customapi](https://preview.becn.com/customapi); Low (details): [APIs.io listing](https://apis.apievangelist.com/store/beacon-pro-plus/) |
| Integration partners | qxo.com/integrations lists AccuLynx, CenterPoint Connect, Dataforma, Estimating Edge, Giddyup, HOVER, JobNimbus, JobTread, Leap, ProjectMapIt, Proline, Roofle, Roofr and ServiceTitan, plus 4 "coming soon". There's no public partner application. | High: [qxo.com/integrations](https://www.qxo.com/integrations) |
| How CRMs do it | **AccuLynx:** an admin enables "QXO" and enters QXO credentials, then picks a preferred branch. You get real-time account pricing, estimate-to-order conversion, real-time status and proof-of-delivery photos. **JobNimbus:** orders use "the most recent QXO pricing when the order is placed", and you can import up to 15 recent QXO templates. **Leap:** QXO branch staff verify each order. **Roofr** (2025-06-10): "live material costs tied to their individual contracts" go into proposals. **Hover:** connect the PRO+ account, then a Supplier Default Branch form; Hover support confirms within about 1 business day. Invoices are not described by any of them except as links back to the QXO portal. | High: [AccuLynx](https://acculynx.com/integration-with-beacon-building-products/), [JobNimbus](https://support.jobnimbus.com/what-is-beacon), [Leap](https://leaptodigital.com/partner/qxo/), [Roofr](https://roofr.com/blog/roofr-and-qxo-integrate-to-streamline-proposal-creation-and-material-ordering-for-roofers), [Hover](https://help.hover.to/en/articles/8417806-submit-orders-directly-to-qxo-from-hover) |
| Takeaway | The pattern is **per-contractor account linking with QXO credentials, a branch selection, and partner-level API access for the software vendor.** What it takes for a small, single-company CRM to get API access is **unknown** and must be asked of QXO. | Inference |
| Ongoing M&A | Kodiak Building Partners (about $2.25B) closed in April 2026. The TopBuild deal (about $17B) was announced in April 2026 and was pending shareholder approval when reported. Home Depot/SRS won GMS (closed September 2025). | Med: [Digital Commerce 360](https://www.digitalcommerce360.com/2026/04/19/qxo-17-billion-acquisition-topbuild/), [Home Depot](https://corporate.homedepot.com/news/company/home-depot-and-its-subsidiary-srs-distribution-complete-acquisition-gms) |

SumoQuote: no current QXO-specific integration doc turned up. A January 2025 Beacon article lists SumoQuote as a JobNimbus integration, not a direct Beacon one ([becn.com](https://becn.com/beaconbits/build-your-business/how-supplier-integration-keeps-your-projects-on-track)). Treat it as unverified.

### B.2 ABC Supply (best-documented)

Developer guide: [apidocs.abcsupply.com](https://apidocs.abcsupply.com/third-party-aggregator-integration-track/). Confidence: High.

- **Two tracks.**
  - **Individual Business (IB):** one company connects its own ABC account(s). It uses OAuth2 Client Credentials and has all scopes. You need your ABC account number and a myABCsupply user on that account. ABC validates before granting production access. ([IB track](https://apidocs.abcsupply.com/individual-business-integration-track/))
  - **Third-Party Aggregator (TPA):** a software platform serving many ABC customers. It uses an OAuth2 Auth Code flow (PKCE optional) per user, plus Client Credentials for platform-level data. Production requires a demo with ABC API Support, sandbox orders that pass, Terms of Use compliance and a named support contact. After launch comes "Hypercare" with a pilot, then General Availability.
- **APIs:**
  - Account: Sold-To, Bill-To, Ship-To, contacts.
  - Product: full catalog, branch availability, recent, frequent and favorite items.
  - **Pricing:** "Price Items" needs a ship-to, branch, item, quantity and optionally a UOM. It returns customer-specific pricing, user token only for a TPA.
  - Location.
  - **Order:** place an order and get a confirmation number. Templates and history are available.
  - **Notification webhooks** for order and invoice status.
  - **Invoice:** history, JSON detail and PDF.
- **Important behaviors:**
  - An order stays "Requested" until the branch accepts or rejects it. Order details aren't available until then.
  - Invoice webhooks cover **only orders placed through the integration.**
  - Catalog and pricing vary by branch, so you must pick a ship-to and a branch first.
- **Terms of Use:** the APIs may **not** be used "to build direct price comparison tools", for resale, to aggregate data as market intelligence, or to resell a repackaged API. Violations can mean permanent termination.
- **Sandbox:** test accounts are provided. Contact API Support to test order placement.
- **Ecosystem:** AccuLynx (pricing, stock, ordering, status, delivery photos: [AccuLynx](https://acculynx.com/integrations/abc-supply/)). ServiceTitan: Early Access, published 2026-04-24, with nightly price updates, PO via API and real-time branch availability ([ServiceTitan](https://help.servicetitan.com/release-hub/docs/connect-abc-supply-integration-to-receive-live-pricing)). Leap: announced 2025-09.

### B.3 SRS Distribution (Home Depot subsidiary) / Roof Hub

- **Per-contractor link:** the contractor enters their **Roof Hub account number and Integration Key**, found under Integrations in Roof Hub, then picks branches and branch contacts. Pricing is pulled per connected branch. Orders from an integrated proposal are locked to SRS. You get a confirmation number, and status updates are pushed back. Invoice sync is not described. ([Roofr help](https://help.roofr.com/en/articles/15591165-integrating-srs-distribution-an-end-to-end-guide))
- **ServiceTitan** (Early Access): account number plus Integration Key. Existing customers also give an invoice number and date or amount for verification. Cost updates are nightly. You can send POs electronically and check branch availability. Status and invoices are not described. ([ServiceTitan](https://help.servicetitan.com/roofing/docs/onboarding-guide-srs-supply-chain-integration-for-servicetitan-customers))
- **Partners:** Roofr (July 2025), JobNimbus, Leap, RoofLink. **No public developer portal found**, so assume a partner agreement is required. Confidence: Med.

### B.4 Gulfeagle Supply

The Gulfeagle Advantage app (launched spring 2024, +175% users as of 2025-06-06) offers account info, order history and delivery tracking. **No API or CRM integration found.** ([Roofing Contractor](https://www.roofingcontractor.com/articles/100900-gulfeagle-advantage-platform-sees-175-growth)) Plan for email-PDF only. Confidence: Med (absence of evidence).

### B.5 Home Depot Pro / Lowe's Pro

- **Home Depot punchout:** credentials come from a Home Depot rep, and one end-to-end test is required before production. Precoro states a **$50k per year minimum spend** for its HD integration. Cancelling in the procurement tool does not cancel at HD; you must contact eprocurement@homedepot.com. ([Precoro HD](https://help.precoro.com/home-depot-punchout-catalog))
- **Lowe's punchout:** a Lowe's rep issues credentials against your account number, and cancellation must also be done directly with Lowe's. ([Precoro Lowe's](https://help.precoro.com/lowes-punchout-catalog))
- **No public REST ordering API found** for either. Standard punchout is cXML or OCI: you shop on the supplier site, the cart comes back, and you send a PO. Confidence: Med.

### B.6 Electrical

- **Graybar:** uses PunchOut and EDI. It also uses Conexiom to turn customers' emailed or non-EDI POs into EDI-like transactions: 1,500+ customers and 83k documents in H1 2021 (article dated 2022-01-28). **Implication: an emailed PDF PO is a first-class channel for Graybar.** ([Conexiom](https://conexiom.com/blog/how-graybar-provides-a-higher-level-of-service-to-customers-with-conexiom/))
- **Wesco:** eCatalogs, EDI/XML (POs, acknowledgements, invoices), PunchOut and buy.wesco.com. No API mentioned. Wesco requires a "compatible procurement system". ([Wesco](https://buy.wesco.com/content/eProcurement))
- **CED:** an EDI integrator lists pre-mapped CED sets 810 (invoice), 832 (price catalog), 846 (inventory), 210 and 214. 850, 855 and 856 are not listed there, so this is unverified. ([Zenbridge](https://zenbridge.io/trading-partners/ced-edi-integration)) Confidence: Low.
- **Rexel/Platt:** the Simpro integration syncs the price book to Rexel pricing, supports POs from office or mobile, and pulls Rexel invoices into Simpro and onto the right job automatically. ([Simpro](https://www.simprogroup.com/partners/integration-partners/rexel)) EDI is supported via B2BE.
- **Regional example (Elliott Electric):** real-time API, EDI, punchout, price files and XML order submission. ([Elliott](https://elliottelectric.com/services-account-b2b-system-integration.aspx))

### B.7 Plumbing/HVAC: Ferguson

- **ServiceTitan "Full Procurement":** catalog plus customer-specific pricing, with "Vendor cost updates flow through nightly". You create POs and send them to Ferguson. Connecting needs the Ferguson **account number and zip code**. ([ServiceTitan Ferguson](https://help.servicetitan.com/docs/ferguson-product-and-pricing-integration))
- ServiceTitan's other full-procurement partners include R.E. Michel, Consolidated Supply, Gensco, Johnstone, Winsupply, Hajoca and Trane, covering electronic invoices, AP reconciliation and payments. ([ServiceTitan list](https://help.servicetitan.com/commercial/docs/available-supply-chain-integrations))
- Ferguson has a developer portal at developer.ferguson.com, but its content needs JavaScript to load and could not be read. Whether external partners can get access is **unknown.**

### B.8 Aggregators

| Name | What it is | Cost | Source |
|---|---|---|---|
| Remarcable | MEP procurement. Claims 150+ electrical and mechanical suppliers across 3,000 branches via EDI, API and direct links. Electronic POs, acknowledgements and ASNs (advance ship notices), invoices, daily pricing. | Custom quote, no public price | [Remarcable](https://www.remarcable.com/blog/how-supplier-integration-keeps-construction-orders-on-track), [Capterra](https://www.capterra.ca/software/1082797/Remarcable) |
| Precoro / Procurify | General procurement. Punchout to HD, Lowe's and others, with approval workflows. | Subscription, not checked | [Precoro](https://precoro.com/integrations/punchouts) |
| Conexiom | Email or PDF PO to structured order, **on the supplier side.** | n/a to contractor | above |
| Supergood | Builds "managed API access" to software without APIs, within a customer's existing access. Possibly a stopgap, but there is ToS risk with supplier portals. | Not checked | [Supergood](https://supergood.ai/docs/acculynx-api) |

**No roofing-specific aggregator** was found that resells unified QXO, ABC and SRS connectivity to a third-party CRM. The roofing CRMs each built direct partnerships.

### B.9 Data format reference (standard X12 meanings)

- **850:** Purchase Order
- **855:** PO Acknowledgment
- **856:** Advance Ship Notice
- **810:** Invoice
- **832:** Price/Sales Catalog
- **846:** Inventory
- **Punchout:** cXML (PunchOutSetupRequest, then a cart, then OrderRequest) or SAP OCI.
- **Modern distributor APIs** (ABC, likely QXO): REST/JSON with OAuth2 and webhooks.

EDI usually needs a VAN (value-added network) or integrator. That isn't worth it for one contractor; it becomes worth it at multi-company scale or through an aggregator.

---

## Part C. Design

### C.1 Connector model

Each **company** has its own **supplier connections**. Credentials are never shared across companies, and neither are cached prices, because account pricing is confidential to each company.

```
suppliers                       -- global directory (QXO, ABC, SRS, Gulfeagle, Ferguson, Graybar, ...)
  id, name, trades[], website, connector_type_available[]  -- api | punchout | edi | email

supplier_connections            -- one row per company per supplier account
  id, company_id, supplier_id,
  connector_type                -- api | punchout | edi | email
  environment                   -- sandbox | production
  status                        -- pending | active | error | disabled
  capabilities jsonb            -- {catalog, pricing, availability, order_submit, order_status,
                                --  delivery_tracking, invoices, cancel}  (each bool; detected + overridable)
  account_number, default_ship_to, default_branch_id,
  order_email, cc_emails[]      -- for the email connector / fallback
  credential_secret_id          -- pointer into Supabase Vault (never the secret itself)
  ordering_enabled bool         -- per-connection kill switch (default false until tested)
  last_success_at, last_error, created_by, verified_at

supplier_branches               -- per connection: branch id, name, address, contact, phone, email
```

- **Credentials:** store them in Supabase Vault (encrypted at rest). Only `security definer` edge functions running with the service role can decrypt. They're never returned to the client and never logged. RLS on every table uses `company_id`. Credential rotation is supported, and so is "disconnect", which deletes the secret.
- **Account linking UX:** the company admin picks a supplier, follows supplier-specific steps (API key or Integration Key, an OAuth redirect, or just an order email), then picks a ship-to and branch. A test call (pricing for one known SKU) sets `verified_at`.
- **Capability flags drive the UI.** No pricing capability means the cost comes from the pricebook or manual entry, labeled "manual". No order_submit means the PO goes out via the email connector. No status capability means a person marks it acknowledged or delivered.
- **The email connector is always present.** Every supplier connection can fall back to it. The other build provides the "email PO PDF" transport, and this spec calls it as a connector.
- **Adapter interface (code):**
  - `getCatalog`
  - `getPrices(items[], branch, shipTo)`
  - `getAvailability`
  - `submitOrder(po, idempotencyKey)`
  - `getOrder(ref)`
  - `cancelOrder`
  - `listInvoices(since)`
  - `getInvoice`
  - `handleWebhook`

  Each adapter declares which methods it implements. Adapters live in edge functions: `supplier-<name>`.
- **Platform vs per-company access:** ABC's IB track gives one app per business. Each future company would need its own IB registration, or the CRM would have to move to ABC's TPA track (OAuth per user). The connection row stores `auth_mode` (`ib_client_credentials` | `tpa_oauth` | `api_key` | `none`) so both can coexist.

### C.2 Material source (trade-agnostic)

Every material line on a proposal, job or PO carries a **material_source**:

| Source | Meaning | Creates PO? | Job cost entry | QuickBooks |
|---|---|---|---|---|
| `supplier` | We buy it from a supplier (`supplier_connection_id` set) | Yes, one PO per supplier, branch and delivery | Actual from the reconciled supplier invoice (estimate = PO line until invoiced) | Bill to the supplier vendor |
| `installer` | The sub or installer furnishes it and bills us | No | From the installer's invoice: labor+material or a material line, vendor = installer | Bill to the installer vendor (materials can be a separate line or item for reporting) |
| `customer` | The homeowner provides it | No | $0 cost, with a line kept for scope, warranty and exclusion language | None (optional handling-fee income) |
| `own_stock` | Pulled from our shop or warehouse | No (restock POs are separate, non-job "stock" POs) | Stock draw at company standard or average cost | Journal entry from inventory/asset to job COGS (Cost of Goods Sold), or nothing if the company expenses stock on purchase. A company setting picks one. |

**Defaults and overrides (most specific wins):**

1. `material_source_defaults(company_id, trade, category)` gives the source plus the default supplier connection and branch. Example: Roofing / Shingles = supplier: QXO Kannapolis.
2. `job_material_overrides(job_id, trade, category)` covers a job-level change, for example "this job's gutters come from ABC" or "this siding job is installer-supplied".
3. A line-level override applies to that line only.

Every override records who made it and why (optional free text).

**Examples:**

- **Roofing:** shingles, underlayment and ridge = supplier (QXO). Pipe boots and nails = own_stock. Skylight = customer-supplied (the homeowner bought a Velux). Gutter coil = supplier (ABC) on the same job, which splits into two POs.
- **Siding:** siding and trim = supplier (QXO). Install crew furnishes J-channel and fasteners = installer, which lands in job costs from the crew's invoice and keeps the margin accurate.
- **Electrical:** panel and breakers = supplier (CED via email PO). Romex and boxes = own_stock from the van. Light fixtures = customer-supplied. An EV charger the homeowner bought online = customer.
- **Plumbing/HVAC:** water heater = supplier (Ferguson). Condenser and air handler = installer (the HVAC sub furnishes the equipment and bills it). Fittings and solder = own_stock.

### C.3 Live pricing in proposals and pricebook

- **Pricebook item to supplier SKU mapping:** `pricebook_item_supplier_skus(pricebook_item_id, supplier_id, sku, uom, conversion)`. One pricebook item can map to SKUs at several suppliers. Help admins match items by importing purchase history and templates, which ABC and SRS both expose.
- **Price cache:** `supplier_prices(connection_id, branch_id, sku, uom, qty_break, unit_price, currency, fetched_at, source)`. It's keyed by **connection**, so never across companies.
  - **Proposal building:** use cached prices younger than 24h. Otherwise fetch live with a short timeout. On failure, show the last price with an "as of <date>" badge.
  - **Nightly refresh:** for SKUs used in open proposals and active pricebook items. This matches the industry norm (ServiceTitan and Ferguson/SRS/ABC all use nightly updates).
  - **Order review:** always re-price live. Pricing must be **15 minutes old or less at confirm.** If live pricing is unavailable, show "unverified price" and require an explicit acknowledgment.
  - **Rate limits:** respect each supplier's limits, batch requests and back off.
- **Proposal snapshot:** when a proposal is sent or signed, freeze each line's `cost_snapshot` (price, `fetched_at`, connection). The customer price never changes automatically.
- **Price change between proposal and order:** the review screen shows **snapshot vs current** per line and in total, plus **projected job margin vs target**.
  - If margin is still at or above the company's `margin_warn_pct`, show the delta only.
  - If it's below `margin_warn_pct`, show a yellow warning that needs a checkbox acknowledgment.
  - If it's below `margin_block_pct`, show a red warning. Only an owner or super-admin can confirm, and they must give a reason.
  - Optionally, the CRM can suggest a change order to the customer. It never sends one automatically.
- **Disclaimers:** supplier prices are quotes until the branch accepts. ABC orders stay "Requested" until the branch accepts them, so the final invoice price is what counts (see C.7).

### C.4 Multiple suppliers on one job

- **Split carts:** when a job's material lines become a draft order, the CRM groups the `supplier` lines by **(supplier_connection, branch, delivery date, delivery address)**. That makes one draft PO per group, and each PO is reviewed and confirmed on its own. The review screen shows all POs for the job side by side with a combined total.
- **Mixed transport:** each PO uses its connection's best available channel (API if order_submit is on and the connection is enabled, otherwise email). Status shows the channel, for example "Sent via QXO API, confirmation #..." or "Emailed to ABC Concord, awaiting acknowledgment".
- **Price comparison (suggestion only):**
  - It runs only when 2 or more connected suppliers have a pricing capability for the mapped SKUs **and** `comparison_allowed = true` for that supplier.
  - **Default `comparison_allowed = false` for ABC** because its Terms of Use forbid "direct price comparison tools". Turn it on only with written confirmation from ABC API Support that internal, single-company buyer comparison is allowed.
  - Default false for QXO and SRS too, until their terms are known.
  - Email-only suppliers can take part using manually entered or last-invoice prices, labeled "last paid".
- **Preferred supplier rule:** per company and trade, keep the preferred supplier unless an allowed alternative is at least `X%` cheaper on the PO total (default 3%) **and** shows availability. Even then, the CRM only *suggests* moving lines and never moves them by itself. Loyalty and rebates (for example QXO rebate tracking) are a reason to keep X above zero.
- **Invoices from each supplier** reconcile against their own PO (C.7). All of them post to the same `job_cost_lines` ledger tagged by vendor, so the job shows a single materials total with a per-supplier breakdown.

### C.5 Ordering safety (owner priority)

**PO state machine:**

```
draft -> in_review -> pending_approval -> approved -> queued (hold window) -> transmitting
  -> submitted -> accepted | rejected
  -> partially_delivered -> delivered -> invoiced -> reconciled
side exits: cancelled (before transmit), cancel_requested (after), failed, submit_unknown
```

**Rules:**

1. **Drafts only from humans or rules, never transmits.** Drafts can be created from a signed proposal, by hand, or by suggestion. Creating a draft never contacts a supplier.
2. **Review screen** shows:
   - supplier, account and branch
   - ship-to address and job address
   - delivery date and method (delivery, will-call, rooftop or ground drop)
   - every line with qty, UOM, unit price and price age
   - subtotal, estimated tax and delivery fees
   - margin impact
   - duplicate warnings
   - channel (API or email) and environment (**TEST** banner if sandbox)
3. **Explicit confirm:** the user must hold the `can_order` permission for the company (default: owners and production managers). The user ticks "I've reviewed this order" and clicks **Place order with <Supplier>**. The client sends `confirm_token = hash(po_id, version, line_items, totals)`. The server recomputes the hash and refuses the order if anything changed since review.
4. **Second approver:** if the total is at or above `second_approval_threshold` (company setting, suggested $10,000 for ARX), the PO goes to pending_approval. A *different* user with `can_approve_orders` must approve it, and the approver sees the same review screen. Self-approval is blocked.
5. **No machine ordering:**
   - Only the `po-submit` edge function can transmit.
   - It requires a **user JWT** (not the service role), a valid confirm_token and a human-session claim.
   - Calls from cron, database triggers, workflow automations, API keys or AI agents are rejected by design. Those callers can only create drafts.
   - The supplier adapters' `submitOrder` is unreachable except through `po-submit`.
   - Unit tests assert this.
6. **PO number and idempotency:**
   - The PO number is generated once at draft, for example `ARX-<job#>-<seq>`, and it's unique per company.
   - `idempotency_key` is a UUID stored on the PO and sent to suppliers that support one. The PO number always goes in the supplier's PO/reference field.
   - Double clicks are collapsed with a row lock and a status check.
   - **If transmission times out,** the status becomes `submit_unknown`. The CRM does **not** auto-retry. It checks the supplier's order history by PO number (where the API allows), and otherwise a person must check with the branch before "Resubmit" is enabled.
7. **Hold window ("oops" window):** after confirm, the PO waits in `queued` for `hold_minutes` (company setting, default 10, can be 0) with a big **Cancel** button. The dispatcher that transmits queued POs can only send POs that already carry a valid human confirmation, and it cannot create or approve anything.
   - After transmit, cancel depends on the supplier. ABC orders sit in "Requested" until the branch accepts, so cancelling means calling the branch. For HD and Lowe's punchout you cancel with the supplier directly.
   - The UI shows the branch phone and email next to "Request cancel" and records the request.
8. **Duplicate detection:**
   - Before review, the CRM flags any other PO for the **same job + same supplier** in the last `N` days (default 14) whose lines overlap by 70% or more by SKU and qty.
   - It also flags the same job + same items at a different supplier, which suggests a likely double order.
   - Confirming past a duplicate warning requires a reason and is logged. Above the approval threshold, the approver sees the warning too.
9. **Test and sandbox mode per connection:** environment = sandbox uses the supplier's sandbox (ABC has one). For suppliers without a sandbox, a "dry run" builds the payload and logs it without sending, and email-mode test sends go only to an internal address. A TEST banner appears everywhere. Switching a connection to production requires an owner.
10. **Kill switches:** `companies.ordering_enabled`, plus per-connection `ordering_enabled`, plus a global platform flag. Any one being off blocks transmission while drafts stay intact. Owners can flip them in one click.
11. **Audit log:** an append-only `po_events` table records actor, role, action, before and after, IP and user agent, request and response payloads (credentials redacted) and timestamps. It covers create, edit, review, confirm, approve, transmit, supplier responses, webhooks, cancel requests and invoice matching. Nobody can delete it, not even admins.
12. **Webhooks and status:**
    - Verify signatures (where offered) and match the supplier reference to the PO.
    - Updates are idempotent by event id.
    - Status updates never trigger new orders.
    - Delivery photos and proof of delivery are attached to the job.

### C.6 Data model additions (summary)

- `purchase_orders`: id, company_id, job_id, supplier_connection_id, branch_id, po_number, idempotency_key, status, channel, environment, delivery_*, totals, confirm_hash, confirmed_by and confirmed_at, approved_by and approved_at, supplier_ref, hold_until
- `purchase_order_lines`: po_id, job_material_line_id, sku, description, qty, uom, unit_price_snapshot, unit_price_confirmed, material_category, trade
- `po_events` (append-only)
- `supplier_invoices`: connection_id, invoice_number, invoice_date, supplier_ref, po_number, totals, pdf_path, source (api | webhook | email_upload | manual), status
- `supplier_invoice_lines`
- `invoice_po_matches`
- `material_source_defaults`, `job_material_overrides`, `pricebook_item_supplier_skus`, `supplier_prices`
- `company_supplier_settings`: second_approval_threshold, hold_minutes, dup_window_days, margin_warn_pct, margin_block_pct, comparison_threshold_pct, comparison_allowed per supplier

All of these get RLS on company_id.

### C.7 Invoice reconciliation into the job cost ledger

1. **Intake:**
   - API or webhook (ABC "Order Invoiced", covering integration-placed orders only), plus scheduled invoice-history pulls.
   - Emailed PDF invoices forwarded to a per-company inbox address and parsed into a draft.
   - Manual upload or entry.
   - The QXO portal offers invoice download, so a QXO invoice export import is an option until the API exists.
2. **Match** on PO number, then supplier order or confirmation number, then job address with a date window. Line matching uses SKU and qty with price tolerance (company setting, for example ±1% or $5).
3. **Variances:** price changes, substitutions, short shipments, returns and credit memos are shown for review. A person approves the match. Credits link to the original invoice.
4. **Post:** an approved match writes `job_cost_lines` (source = `supplier_invoice`, source_id, vendor, category, trade, amount). This is the **single ledger**. Open PO amounts show on the job as **committed** cost, a separate view that is not posted. Installer, own-stock and customer lines post through their own paths (C.2) into the same ledger.
5. **QuickBooks (later phase):** each reconciled invoice becomes a QBO Bill to the mapped vendor, using the job as customer/project and the class or category. **Choose one path per company.** If the company already imports supplier invoices into QBO another way (for example the QXO QuickBooks download), turn CRM bill creation off for that supplier to avoid double-posting.
6. **Monthly statement check:** ARX pays QXO on the 20th for the prior month's installs. A statement view compares the supplier's statement against reconciled invoices and flags any invoice not tied to a job.

---

## Part D. Phased plan

All estimates are **rough, labeled estimates** of developer time with AI assistance on the existing Supabase CRM. They exclude waiting on suppliers, which is often the longest part.

| Phase | Scope | Rough estimate |
|---|---|---|
| **0. Owner actions** | See the list below. Runs in parallel with everything else. | 1–6 weeks of calendar time, supplier-dependent |
| **1. Foundation + email ordering** | Supplier directory, company connections (email type), material_source defaults and overrides, job material lines to split draft POs, the full safety system from C.5 (review, confirm hash, approvals, hold window, duplicates, kill switch, audit), PO PDF via the email build, manual acknowledgment and delivery, manual or upload invoice entry with matching into job_cost_lines. **Delivers most of the safety and job-cost value with no supplier API at all.** | 3–4 weeks (estimate) |
| **2. Pricing cache + margin warnings** | SKU mapping, price cache, proposal snapshot, review-time re-price, margin thresholds. Manual and last-paid prices first. | 1–2 weeks (estimate) |
| **3. First API connector** | **QXO if access is granted**, since it's the main supplier. While waiting, build the adapter framework against **ABC's sandbox**, which is documented and open today. ABC IB track: pricing, availability, order submit, webhooks, invoices. | 2–3 weeks for the framework + ABC (estimate); QXO 2–4 weeks after docs arrive (estimate, unknown API) |
| **4. SRS connector** | Only if ARX buys from SRS and a partner agreement or Integration Key API is available. | 2–3 weeks (estimate) |
| **5. QuickBooks bills** | Reconciled invoices become QBO Bills, with vendor and class mapping and double-post guard. | 1–2 weeks (estimate) |
| **6. Multi-company and other trades** | ABC TPA (OAuth) track application, per-company onboarding wizard, price comparison (only where terms allow), punchout (HD/Lowe's), and evaluating Remarcable or an EDI integrator for electrical and plumbing distributors versus email + invoice capture. | 4–8+ weeks (estimate), plus partner approvals |

**Supplier order:**
1. QXO (main supplier, ask now).
2. ABC (best docs, use it as the framework and build the reference connector).
3. SRS (if used).
4. Everyone else on email PDF.
5. Electrical and plumbing via email + invoice capture until there's volume to justify EDI or an aggregator.

**Owner actions (Nathan):**

1. **QXO:** contact QXO API Services (qxo.com "API Services" / customapi page, sitesupport@qxo.com, (888) 685-6111) and your QXO rep or branch manager.
   - Ask whether a contractor's in-house CRM can get API access to the QXO / former Beacon PRO+ API for your own account.
   - Ask for docs, sandbox, auth method, rate limits, webhooks, whether invoices are included, cancellation rules and terms (including price comparison).
   - Have your QXO account number(s), ship-to(s) and the Kannapolis branch ID ready.
2. **ABC Supply** (if you buy from them or want a second supplier): register on the ABC Partner Developer Portal and choose the **Individual Business** track. Have your ABC account number and a myABCsupply login on that account. Ask API Support in writing whether internal comparison against other suppliers is allowed under the Terms of Use.
3. **SRS** (if used): get your Roof Hub account number and Integration Key, and ask your SRS rep whether non-listed software can use it.
4. **Gulfeagle, Home Depot, Lowe's, electrical, plumbing:** collect the order email per branch and your account number for the email connector.
5. **Decide the company settings:**
   - who can order and who can approve
   - the second-approval threshold
   - the hold window minutes
   - margin warn and block percentages
   - the duplicate window
   - default material source per trade and category
6. **Do not** share supplier portal passwords with the CRM if a supplier offers an integration key or API instead. Never use screen-scraping of supplier portals without written permission (ToS risk).

---

## Open questions and uncertainties

- What QXO's API access policy is for non-partner, single-company software. Unknown; this is the biggest dependency.
- Whether the "Beacon PRO+" API on APIs.io matches what QXO offers today. Unverified third-party listing.
- Whether SRS has any route besides named software partners.
- Ferguson's developer portal scope (content didn't load without JavaScript), and CED's 850/855/856 support.
- How ABC's "no price comparison tools" clause applies to a single company's internal buyer screen. Get it in writing.
- Supplier invoice availability via API for orders *not* placed through the integration. ABC: no. Others: unknown. Plan for email and upload invoice capture permanently.
