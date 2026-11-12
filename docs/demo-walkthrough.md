# Demo walkthrough — the 10-minute tour

Company on screen: **Gulf Coast Grounds & Exterior** (fictional lawn, landscape, tractor and pressure-wash company). Everything here is made up: names, 555-01xx phones, demo.example.com emails. Nothing you tap can email, text, charge a card or touch a bank. Start on a phone; open the laptop only for the money screens.

Setup before the call: `npm run seed:company -- --demo --apply` (add `--reset` to start clean, `--name="Precision Maintenance"` and `--logo-url=https://…` to dress it for the prospect). The script prints the logins once. Sign in as the owner on the laptop and as the crew lead on the phone.

## The tour, in the order a Jobber user feels the pain

1. **Rain day, one tap (phone, owner).** Visits → *Rain day*. Tomorrow is already filled in; tap "Next day". Every mowing stop on that day moves, in one go, and keeps its original slot. Jobber makes you reschedule stops one by one. Show last month's rain day: the moved visits are marked.
2. **The crew's day on a phone (phone, crew lead).** Open the crew link. Stops in route order, gate code and "dog, keep gate closed" right on the stop. One tap on a skip reason skips the visit (6-second undo). Done offers "Add a photo?". No login for the crew members, no app to install.
3. **Customers with many properties (laptop).** Customers → *Harborview Condominium Association*: three properties on one account, each with its own plan, gate code, dog and irrigation fields. These are custom fields the owner added in Settings — no developer. Tell them: your commercial accounts do not have to be five fake customers.
4. **Plans that run themselves (laptop).** Settings → *Plan templates*: weekly mowing that changes with the season (weekly April to October, every 2 weeks in March and November, monthly in winter), biweekly, monthly, quarterly pressure wash, and a care-style inspection plan with a green / yellow / red follow-up visit. Price by yard size, not by hand. A visit list six weeks back and six weeks ahead is already there; some done with photos, some skipped with reasons.
5. **The clock for the whole crew (phone, crew lead).** One tap clocks in the crew, lunch pauses it, Done asks "Clock out crew?". Machines (the tractor) clock too. Open Money → *Time* on the laptop: needs-a-look first, overtime and long-day warnings.
6. **Bill the tractor by the hour (laptop).** Jobs → Schedule → *Hours to bill*: the driveway grading job has two days of crew and tractor hours waiting. One button makes the invoice. Rounding and minimums are the company's own rules.
7. **Quotes with options and a deposit (phone, then laptop).** Open the *Front-yard refresh* quote: optional items the customer can tick, total and tax update live. The *Backyard drainage + sod* quote is approved with the 25% deposit paid. One quote has expired, so you can show what that looks like and how to resend.
8. **Get paid (laptop).** Money → *Ready to bill*: finished visits become invoices per visit or one per month. Show a paid one, an overdue one, and the Today card that lists them. Online payments are in test mode only.
9. **The customer's side (phone).** Open the portal magic link (Dana Whitfield). She sees her next visit, photos, invoices, her plan, and can message the office. The reply appears in the thread; the reminder and "on the way" emails are in the log, suppressed (this is a demo).
10. **Orders and payroll (laptop).** A purchase order to each of two vendors, one bill recorded against its job cost. Payroll → this pay week: two hourly crew leads and one commission salesperson, hours coming straight from the clock. Close on Today: the morning card list and the morning email show the same items.

## Things to say, not show
- The company's own words: plans, prices, seasons, fields and trades are all settings, not code.
- Nothing is lost on a switch: Move from Jobber brings customers, properties, plans and invoice history over.
- What is NOT in the demo on purpose: QuickBooks (not connected), a live card processor, a real text number, AI changes. Texting and the AI connector exist; here they are test / read-only.
- Email never leaves the demo: every company-owned send (customer, signing, invoice, supplier order, payroll, alerts) is logged only. Two mail paths take no company and are not reachable from a demo login: the public website estimate (`lib/public-estimate-lead.ts`, a visitor form on the company's public site) and trial sign-up (`app/api/trial-signup/route.ts`, a public marketing form).

## Resetting
`npm run seed:company -- --demo --reset --apply` wipes only the demo company (it refuses any company without the demo flag) and rebuilds it with fresh logins. Without `--apply` it only says what it would do.
