# ARX Internal CRM

Internal-first CRM and estimating system for ARX Roofing Company. Built with Next.js, Supabase, and TypeScript.

## Features

- **CRM**: Leads, customers, and projects pipeline with activities and file uploads
- **Canvassing**: Map-based lead management with pin drops
- **Estimating Engine**: Pricebook-based estimates with labor multipliers, required adders, and tax calculation
- **Proposal Generation**: PDF proposals with scope of work
- **AI Helpers**: Sanity check for missing adders and scope-of-work generation
- **Multi-tenant Ready**: Org isolation from day one

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Auth + Storage + RLS)
- **PDF**: React-pdf (server-side)
- **Maps**: Google Maps JS API
- **AI**: OpenAI API (server routes only)
- **Deploy**: Vercel

## Prerequisites

- Node.js 18+ and npm/yarn
- Supabase account and project
- OpenAI API key
- Google Maps API key (optional for map features)

## Setup

### 1. Clone and Install

```bash
git clone <repo-url>
cd arx-internal-crm
npm install
```

### 2. Supabase Setup

1. Create a new Supabase project at https://supabase.com
2. Go to SQL Editor and run the migrations in order:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_rls_policies.sql`
   - `supabase/migrations/003_storage_buckets.sql`

3. Create a storage bucket named `files`:
   - Go to Storage in Supabase dashboard
   - Create new bucket: `files` (private)
   - The RLS policies from migration 003 will handle access

4. Get your Supabase credentials:
   - Project URL (Settings → API)
   - Anon key (Settings → API)
   - Service role key (Settings → API) - **Keep this secret!**

### 3. Environment Variables

Create a `.env.local` file:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# OpenAI
OPENAI_API_KEY=your_openai_api_key

# Google Maps (optional)
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
```

### 4. Seed Database

Run the seed script to create default org and pricebook:

```bash
npx tsx scripts/seed.ts
```

**Important**: After seeding, you must:
1. Create an admin user in Supabase Auth dashboard (Authentication → Users → Add User)
2. Insert a user record in the `users` table:
   ```sql
   INSERT INTO users (id, org_id, role, full_name, email, active)
   VALUES (
     'auth-user-id-from-step-1',
     'org-id-from-seed-output',
     'admin',
     'Your Name',
     'your-email@example.com',
     true
   );
   ```

### 5. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with your admin user.

## Project Structure

```
arx-internal-crm/
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes (AI, PDF, estimates)
│   ├── dashboard/         # Dashboard page
│   ├── leads/             # Leads pages
│   ├── projects/          # Projects pages
│   ├── estimates/         # Estimate builder
│   ├── pricebook/         # Pricebook view
│   ├── customers/         # Customers pages
│   └── canvass/           # Map page
├── components/            # React components
├── lib/                   # Utilities
│   ├── supabase/         # Supabase clients
│   ├── auth.ts           # Auth helpers
│   ├── calculations.ts   # Estimate calculations
│   └── required-adders.ts # Required adders validation
├── supabase/
│   └── migrations/        # SQL migrations
├── scripts/
│   └── seed.ts           # Database seed script
└── lib/__tests__/        # Tests
```

## Business Rules

### Pricing Model

```
Total = Subtotal + Tax
Subtotal = (LaborSubtotal * (1 + steep_pct + high_pct)) + MaterialsSubtotal - discount_amount
Tax = taxable_subtotal * tax_rate (default 0.08)
```

- Multipliers apply **ONLY** to labor lines (`is_labor=true`)
- Default tax rate: 8%
- Default steep tiers: [0, 0.10, 0.20, 0.30]
- Default high tiers: [0, 0.10, 0.15]

### Required Adders

**Roofing:**
- If any "Roof Install" line exists → require "Dump/Haul Away" (job)
- If any Tear-off line exists → require "Clean-up/Magnetic Sweep" (job)
- If any "Roof Install" line exists → require Pipe Boots qty >= vents_count

**Tear-off:**
- Default: Tear-off 1 Layer qty = roof_squares
- If layers >= 2 → Additional Layer qty = roof_squares

**Windows:**
- If any Window Install line exists → require Window Disposal qty = total_windows

### Snapshot Pricing

Estimate lines store `name` and `unit_price` at creation time. Pricebook changes do not affect existing estimates.

## API Routes

### `/api/estimates/[id]`
- `PATCH`: Update estimate (multipliers, discount, tax rate)

### `/api/estimates/[id]/lines`
- `POST`: Add estimate line

### `/api/estimates/[id]/lines/[lineId]`
- `PATCH`: Update estimate line
- `DELETE`: Delete estimate line

### `/api/estimates/[id]/pdf`
- `POST`: Generate proposal PDF (validates required adders first)

### `/api/ai/sanity-check?estimate_id=...`
- `GET`: Check for missing adders and potential issues

### `/api/ai/scope?estimate_id=...`
- `POST`: Generate scope of work from estimate lines

## Testing

Run tests:

```bash
npm test
```

Current test coverage:
- Calculation functions (`lib/__tests__/calculations.test.ts`)
- Required adders validator (`lib/__tests__/required-adders.test.ts`)

## Deployment

### Vercel

1. Push code to GitHub
2. Import project in Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

### Environment Variables in Vercel

Add all variables from `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (optional)

## Development Notes

### Decisions Made

1. **PDF Generation**: Using React-pdf for server-side PDF generation. The current implementation is a placeholder - you may want to use Playwright or Puppeteer for more advanced PDF generation.

2. **Google Maps**: Map integration is scaffolded but requires API key. The map component shows a placeholder until the key is configured.

3. **Auth Flow**: Uses Supabase Auth with middleware protection. All routes except `/login` require authentication.

4. **RLS Policies**: All tables have RLS enabled with org-based isolation. Users can only access data in their org.

5. **Required Adders**: Validation is rules-based with optional AI suggestions. The validation runs client-side for immediate feedback.

6. **Estimate Calculations**: All calculations happen client-side for real-time updates, then synced to server on save.

## Future Enhancements

- [ ] Full Google Maps integration with pin drops
- [ ] File upload UI for photos/documents
- [ ] Email sending for proposals
- [ ] Advanced reporting and analytics
- [ ] Mobile app (React Native)
- [ ] Multi-tenant billing/subscriptions

## Support

For issues or questions, contact the development team.

## License

Proprietary - ARX Roofing Company
