-- Reporting layer: every metric is defined ONCE, here, as a SQL view. Screens, exports and emails read these views
-- (lib/reporting/*); nobody recomputes profit, collected, close-rate inputs, etc. in TypeScript.
--
-- Additive: views only, plus the saved-report table at the bottom. security_invoker = true so RLS of the caller
-- applies if a view is ever read with a user JWT; the report runner reads with the service client and ALWAYS adds the
-- org filter and the role scope (lib/reporting/run.ts) — org_id is the first column of every view.
--
-- Money columns are dollars (numeric 12,2) here because the source tables are dollars; job_payments is cents and is
-- converted once, in rpt_payments. Statuses are the source enums, unchanged.

-- Jobs: one row per production job with its cost, collected and profit computed once.
CREATE OR REPLACE VIEW rpt_jobs WITH (security_invoker = true) AS
SELECT j.org_id,
       j.id                         AS job_id,
       j.job_number,
       j.status,
       j.job_type,
       j.address_text               AS address,
       j.job_source,
       j.sale_date,
       j.completed_at,
       j.cancelled_at,
       j.scheduled_date,
       j.materials_status,
       j.permit_status,
       j.salesperson_id,
       u.full_name                  AS salesperson,
       CASE WHEN j.status = 'cancelled' THEN 0 ELSE COALESCE(j.sale_amount, 0) END AS sale_amount, -- cancelled jobs are not sales
       COALESCE(j.dealer_fee_amount, 0) AS dealer_fee,
       -- cost = live ledger lines (dealer-fee mirror line excluded) + dealer fee (see docs/one-cost-ledger.md)
       COALESCE(c.cost, 0) + COALESCE(j.dealer_fee_amount, 0)                       AS cost_total,
       COALESCE(p.collected, 0)                                                     AS collected,
       CASE WHEN j.status = 'cancelled' THEN 0
            ELSE COALESCE(j.sale_amount, 0) - COALESCE(j.dealer_fee_amount, 0) - COALESCE(c.cost, 0) END AS profit_before_commission,
       -- money still owed on the sale, and how old the sale is (AR aging); cancelled jobs owe nothing
       CASE WHEN j.status = 'cancelled' THEN 0
            ELSE GREATEST(COALESCE(j.sale_amount, 0) - COALESCE(p.collected, 0), 0) END AS balance_due,
       CASE WHEN j.sale_date IS NULL THEN NULL ELSE (CURRENT_DATE - j.sale_date::date) END AS days_since_sale,
       CASE WHEN j.sale_date IS NULL THEN 'no sale date'
            WHEN CURRENT_DATE - j.sale_date::date <= 30 THEN '0-30 days'
            WHEN CURRENT_DATE - j.sale_date::date <= 60 THEN '31-60 days'
            WHEN CURRENT_DATE - j.sale_date::date <= 90 THEN '61-90 days'
            ELSE 'over 90 days' END AS aging_bucket
FROM production_jobs j
LEFT JOIN users u ON u.id = j.salesperson_id
LEFT JOIN LATERAL (
  SELECT SUM(l.amount) AS cost
  FROM job_cost_lines l
  WHERE l.job_id = j.id AND l.status = 'active' AND l.deleted_at IS NULL
    AND l.description IS DISTINCT FROM 'Lender / dealer fee'
) c ON true
LEFT JOIN LATERAL (
  SELECT SUM(pm.amount_cents) / 100.0 AS collected
  FROM job_payments pm
  WHERE pm.job_id = j.id AND pm.funding_status IS DISTINCT FROM 'pending'
) p ON true;

-- Sales: one row per signed (completed) sale agreement, credited to the deal's closer and setter.
CREATE OR REPLACE VIEW rpt_sales WITH (security_invoker = true) AS
SELECT c.org_id,
       c.id                       AS contract_id,
       c.agreement_type,
       c.customer_signed_at       AS signed_at,
       c.project_address          AS address,
       COALESCE(c.project_cost, 0) AS amount,
       c.payment_method,
       c.opportunity_id,
       o.owner_user_id            AS closer_user_id,
       cl.full_name               AS closer,
       o.setter_user_id           AS setter_user_id,
       st.full_name               AS setter,
       o.job_source,
       COALESCE(o.is_self_generated, false) AS is_self_generated
FROM order_form_contracts c
LEFT JOIN opportunities o ON o.id = c.opportunity_id
LEFT JOIN users cl ON cl.id = o.owner_user_id
LEFT JOIN users st ON st.id = o.setter_user_id
WHERE c.status = 'completed' AND c.agreement_type IN ('installation', 'repair') AND c.customer_signed_at IS NOT NULL;

-- Payments: money in, in dollars, with the job it belongs to.
CREATE OR REPLACE VIEW rpt_payments WITH (security_invoker = true) AS
SELECT j.org_id,
       pm.id                      AS payment_id,
       pm.job_id,
       j.job_number,
       pm.paid_at,
       pm.amount_cents / 100.0    AS amount,
       pm.payment_type,
       pm.method,
       pm.funding_status,
       j.sale_date
FROM job_payments pm
JOIN production_jobs j ON j.id = pm.job_id;

-- Job costs: live ledger lines.
CREATE OR REPLACE VIEW rpt_job_costs WITH (security_invoker = true) AS
SELECT l.org_id,
       l.id                       AS cost_line_id,
       l.job_id,
       j.job_number,
       l.description,
       l.cost_type,
       l.amount,
       l.incurred_on,
       l.approved,
       l.source,
       v.name                     AS vendor
FROM job_cost_lines l
JOIN production_jobs j ON j.id = l.job_id
LEFT JOIN vendors v ON v.id = l.vendor_id
WHERE l.status = 'active' AND l.deleted_at IS NULL;

-- Payroll lines (SENSITIVE: pay). One row per payout line.
CREATE OR REPLACE VIEW rpt_payroll_lines WITH (security_invoker = true) AS
SELECT l.org_id,
       l.id                       AS payout_line_id,
       l.user_id,
       u.full_name                AS person,
       l.participant_role,
       l.job_id,
       j.job_number,
       p.period_label,
       p.status                   AS period_status,
       p.scheduled_pay_date,
       l.gross_amount,
       l.net_amount
FROM payroll_payout_lines l
JOIN payroll_periods p ON p.id = l.payroll_period_id
LEFT JOIN users u ON u.id = l.user_id
LEFT JOIN production_jobs j ON j.id = l.job_id;

-- Appointments (inspections, adjuster meetings, ...). was_completed = appointment status 'completed'. NOTE: this is NOT the
-- goals/dashboard 'sit' (org-configured inspection outcomes on opportunities.inspection_outcome_at); see docs/reporting.md.
CREATE OR REPLACE VIEW rpt_appointments WITH (security_invoker = true) AS
SELECT a.org_id,
       a.id                       AS appointment_id,
       a.scheduled_for,
       COALESCE(a.appointment_type, 'inspection') AS appointment_type,
       a.status,
       a.closer_user_id,
       cl.full_name               AS closer,
       a.canvasser_user_id        AS setter_user_id,
       st.full_name               AS setter,
       (a.status = 'completed')   AS was_completed,
       (a.status = 'cancelled')   AS was_cancelled,
       a.opportunity_id,
       a.lead_id
FROM scheduled_appointments a
LEFT JOIN users cl ON cl.id = a.closer_user_id
LEFT JOIN users st ON st.id = a.canvasser_user_id;

-- Leads (excluding the bulk Solar import pins, which are not doors/leads worked by reps).
CREATE OR REPLACE VIEW rpt_leads WITH (security_invoker = true) AS
SELECT l.org_id,
       l.id                       AS lead_id,
       l.created_at,
       l.status,
       l.source,
       l.canvass_disposition,
       l.owner_user_id,
       u.full_name                AS owner
FROM leads l
LEFT JOIN users u ON u.id = l.owner_user_id
WHERE l.source IS DISTINCT FROM 'solar_import';

-- Opportunities: post-inspection pipeline. is_sold is one definition: has a completed sale agreement.
CREATE OR REPLACE VIEW rpt_opportunities WITH (security_invoker = true) AS
SELECT o.org_id,
       o.id                       AS opportunity_id,
       o.created_at,
       o.status,
       o.pipeline_stage,
       o.inspection_outcome,
       o.inspection_outcome_at,
       o.job_source,
       o.owner_user_id            AS closer_user_id,
       cl.full_name               AS closer,
       o.setter_user_id,
       st.full_name               AS setter,
       COALESCE(o.estimated_value, 0) AS estimated_value,
       EXISTS (SELECT 1 FROM order_form_contracts c
                WHERE c.opportunity_id = o.id AND c.status = 'completed'
                  AND c.agreement_type IN ('installation', 'repair')) AS is_sold
FROM opportunities o
LEFT JOIN users cl ON cl.id = o.owner_user_id
LEFT JOIN users st ON st.id = o.setter_user_id;

-- Referral partners.
CREATE OR REPLACE VIEW rpt_referral_partners WITH (security_invoker = true) AS
SELECT r.org_id,
       r.id                       AS partner_id,
       r.name,
       r.company,
       r.status,
       r.assigned_user_id         AS owner_user_id,
       u.full_name                AS owner,
       r.assigned_at,
       r.last_touched_at,
       (SELECT count(*) FROM opportunities o WHERE o.referral_partner_id = r.id) AS referred_opportunities
FROM referral_partners r
LEFT JOIN users u ON u.id = r.assigned_user_id;

-- Canvass doors: one row per knock.
CREATE OR REPLACE VIEW rpt_canvass_doors WITH (security_invoker = true) AS
SELECT k.org_id,
       k.id                       AS knock_id,
       k.created_at               AS knocked_at,
       k.user_id,
       u.full_name                AS rep,
       k.disposition,
       k.source
FROM canvass_knocks k
LEFT JOIN users u ON u.id = k.user_id
WHERE k.source IS DISTINCT FROM 'solar_import';

-- Views are read through the API only (service role). Nobody reads them with the anon key.
REVOKE ALL ON rpt_jobs, rpt_sales, rpt_payments, rpt_job_costs, rpt_payroll_lines, rpt_appointments,
              rpt_leads, rpt_opportunities, rpt_referral_partners, rpt_canvass_doors FROM anon, authenticated;

-- Saved reports (shareable by role). Nullable/additive. org_id on every row.
CREATE TABLE IF NOT EXISTS saved_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name          text NOT NULL,
  spec          jsonb NOT NULL,              -- { template?, dataset, filters, groupBy, metric, ... } — see lib/reporting/spec.ts
  shared_roles  text[] NOT NULL DEFAULT '{}', -- roles that can open it besides the creator
  schedule      text,                        -- NULL = not emailed; 'daily' | 'weekly_mon' | 'monthly_1' (sent by the 7am cron)
  schedule_recipients text[] NOT NULL DEFAULT '{}',
  dashboard_widget boolean NOT NULL DEFAULT false, -- shown as a tile on the creator's dashboard
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_sent_at  timestamptz
);
CREATE INDEX IF NOT EXISTS idx_saved_reports_org ON saved_reports (org_id);
ALTER TABLE saved_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON saved_reports FROM anon, authenticated;
COMMENT ON TABLE saved_reports IS 'Saved/shared report definitions (spec jsonb) and optional email schedule. Service-role access only; the API enforces org + role sharing.';

-- Rollback:
--   DROP TABLE IF EXISTS saved_reports;
--   DROP VIEW IF EXISTS rpt_jobs, rpt_sales, rpt_payments, rpt_job_costs, rpt_payroll_lines, rpt_appointments,
--     rpt_leads, rpt_opportunities, rpt_referral_partners, rpt_canvass_doors;
