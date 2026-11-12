-- Signing engine PR3: send ANY PDF for signature (placed fields, several signers in order, reusable templates, bulk send).
-- Additive only. Apply AFTER 202611200010 (signing engine).
-- Order vs the code: apply this BEFORE deploying the PR3 code. It only adds tables and WIDENS one check, so the code already running is unaffected
-- (it never writes 'signature-request'), while the new /signing screens and /api/signing/requests|templates routes need these tables and would
-- fail on a missing one. Applying it after the code just leaves those new screens erroring until it lands; nothing existing breaks either way.
-- Nothing here touches a contract or change order.

-- An envelope can now be about a signature request too.
ALTER TABLE public.signing_envelopes DROP CONSTRAINT IF EXISTS signing_envelopes_doc_kind_check;
ALTER TABLE public.signing_envelopes ADD CONSTRAINT signing_envelopes_doc_kind_check CHECK (doc_kind IN ('contract', 'change-order', 'signature-request'));

-- A saved layout: the PDF, who signs ("roles"), and where each field goes. Owners save it once and send it again and again.
CREATE TABLE IF NOT EXISTS public.signature_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.orgs(id),
  name           text NOT NULL,
  source_path    text NOT NULL,           -- the PDF in the private `files` bucket
  source_sha256  text NOT NULL,
  page_count     integer NOT NULL CHECK (page_count BETWEEN 1 AND 60),
  roles          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ key, label, order }]
  fields         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ id, roleKey, kind, page, x, y, w, h, required, label }] (page fractions 0..1)
  created_by     uuid,
  archived_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signature_templates_org_idx ON public.signature_templates (org_id) WHERE archived_at IS NULL;

-- One document out for signature. `status` is the truth for the request (like order_form_contracts.status for a contract).
CREATE TABLE IF NOT EXISTS public.signature_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.orgs(id),
  title             text NOT NULL,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'voided', 'declined')),
  signing_order     text NOT NULL DEFAULT 'parallel' CHECK (signing_order IN ('parallel', 'serial')),
  source_path       text NOT NULL,
  source_sha256     text NOT NULL,
  page_count        integer NOT NULL CHECK (page_count BETWEEN 1 AND 60),
  template_id       uuid REFERENCES public.signature_templates(id),
  batch_id          uuid,                  -- set when made by a bulk send
  customer_id       uuid,
  opportunity_id    uuid,
  job_id            uuid,
  message           text,
  expires_at        timestamptz NOT NULL,
  signed_path       text,                  -- the flattened signed PDF (set once, at completion)
  completed_at      timestamptz,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signature_requests_org_idx ON public.signature_requests (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS signature_requests_customer_idx ON public.signature_requests (org_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS signature_requests_batch_idx ON public.signature_requests (batch_id) WHERE batch_id IS NOT NULL;

-- Each signer has their own link (hashed, like every other signing link), their own turn, their own evidence.
CREATE TABLE IF NOT EXISTS public.signature_request_signers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.orgs(id),
  request_id       uuid NOT NULL REFERENCES public.signature_requests(id) ON DELETE CASCADE,
  role_key         text NOT NULL,
  role_label       text NOT NULL,
  name             text NOT NULL,
  email            text,
  phone            text,
  order_index      integer NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'viewed', 'signed', 'declined')),
  token_hash       text NOT NULL,
  token_enc        text,
  notified_at      timestamptz,
  reminder_count   integer NOT NULL DEFAULT 0,
  viewed_at        timestamptz,
  signed_at        timestamptz,
  declined_at      timestamptz,
  decline_reason   text,
  ip               text,
  user_agent       text,
  consent_version  text,
  consent_at       timestamptz,
  signature_data   text,                   -- adopted once: PNG data URL, or "typed:<name>"
  initials_data    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signature_request_signers_role_once UNIQUE (request_id, role_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS signature_request_signers_token_idx ON public.signature_request_signers (token_hash);
CREATE INDEX IF NOT EXISTS signature_request_signers_request_idx ON public.signature_request_signers (request_id);

-- Placed fields of one request (copied from the template or placed by hand). Position = fractions of the page, so it works at any zoom.
CREATE TABLE IF NOT EXISTS public.signature_fields (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.orgs(id),
  request_id  uuid NOT NULL REFERENCES public.signature_requests(id) ON DELETE CASCADE,
  role_key    text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('signature', 'initials', 'date', 'text', 'checkbox', 'name')),
  page        integer NOT NULL CHECK (page >= 0),
  x           double precision NOT NULL CHECK (x >= 0 AND x <= 1),
  y           double precision NOT NULL CHECK (y >= 0 AND y <= 1),
  w           double precision NOT NULL CHECK (w > 0 AND w <= 1),
  h           double precision NOT NULL CHECK (h > 0 AND h <= 1),
  required    boolean NOT NULL DEFAULT true,
  label       text,
  value       text,                        -- text / date / name / "true" for a checked box; signatures live on the signer
  filled_at   timestamptz
);
CREATE INDEX IF NOT EXISTS signature_fields_request_idx ON public.signature_fields (request_id);

-- Service role only (the app always reads and writes through the server), like the engine tables.
ALTER TABLE public.signature_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_request_signers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_fields ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signature_templates, public.signature_requests, public.signature_request_signers, public.signature_fields FROM anon, authenticated;

SELECT pg_notify('pgrst', 'reload schema');
