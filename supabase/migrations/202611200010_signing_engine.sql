-- Signing engine (PR1 + PR2). Additive only; the app is live and signing has worked for months.
-- Apply AFTER 202611160010/0020/0030 (signing safety) and BEFORE the code that uses it (deploy order in CLAUDE.md "Signing engine").
-- Nothing here changes a contract or change-order row except two nullable consent columns written only when a company turns the
-- consent step on. The document PDFs are untouched: the certificate is its own file.

-- One lifecycle record per document sent for signature, whatever provider carries it ('native' = our signing pages; 'docusign' later).
-- Rows are made lazily (ensureEnvelope) so every contract / change order that already exists keeps working with no backfill.
CREATE TABLE IF NOT EXISTS public.signing_envelopes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.orgs(id),
  doc_kind             text NOT NULL CHECK (doc_kind IN ('contract', 'change-order')),
  doc_id               uuid NOT NULL,
  provider             text NOT NULL DEFAULT 'native' CHECK (provider IN ('native', 'docusign')),
  provider_ref         text,
  status               text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'viewed', 'completed', 'declined', 'voided')),
  -- [{ role, name, email, order, status, signedAt }]; the company rep signs first (order 0), the customer next.
  signers              jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{ role: 'agreement' | 'certificate', title, storagePath, sha256 }]
  documents            jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Reserved for placed fields (send-any-PDF, later); contracts and change orders keep their own form fields.
  fields               jsonb NOT NULL DEFAULT '[]'::jsonb,
  sent_at              timestamptz,
  first_viewed_at      timestamptz,
  completed_at         timestamptz,
  declined_at          timestamptz,
  decline_reason       text,
  voided_at            timestamptz,
  voided_by            uuid,  -- plain uuid: no FK, so deleting a user never touches evidence (see signing_events trigger)
  void_reason          text,
  reminder_count       integer NOT NULL DEFAULT 0,
  last_reminder_at     timestamptz,
  consent_version      text,
  pdf_sha256           text,
  pdf_hashed_at        timestamptz,
  certificate_path     text,
  certificate_sha256   text,
  filed_at             timestamptz,
  copies_sent_at       timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signing_envelopes_one_per_doc UNIQUE (org_id, doc_kind, doc_id)
);
CREATE INDEX IF NOT EXISTS signing_envelopes_open_idx ON public.signing_envelopes (org_id, status) WHERE status IN ('sent', 'viewed');

-- Append-only evidence: who did what, when, from where. Never updated, never deleted.
CREATE TABLE IF NOT EXISTS public.signing_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.orgs(id),
  envelope_id      uuid NOT NULL REFERENCES public.signing_envelopes(id),
  doc_kind         text NOT NULL,
  doc_id           uuid NOT NULL,
  -- Which signer the event is about ('customer', 'company', or a later signer's key); '' for envelope-level events.
  signer_key       text NOT NULL DEFAULT '',
  event            text NOT NULL CHECK (event IN (
    'sent', 'resent', 'reminder_sent', 'viewed', 'consent_given', 'signed', 'declined', 'voided', 'extended',
    'completed', 'certificate_issued', 'copy_sent', 'filed'
  )),
  actor_type       text NOT NULL DEFAULT 'system' CHECK (actor_type IN ('signer', 'staff', 'system', 'provider')),
  actor_user_id    uuid,  -- plain uuid, no FK: a user delete must never need to UPDATE this append-only table
  actor_name       text,
  actor_email      text,
  ip               text,
  user_agent       text,
  consent_version  text,
  meta             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signing_events_envelope_idx ON public.signing_events (envelope_id, created_at);
-- Each of these happens once per envelope (envelope-level: signer_key '') or once per signer (signer-level events), however many
-- times a recovery runs. Per (envelope, signer, event) so an envelope with several signers records each signer's own events.
CREATE UNIQUE INDEX IF NOT EXISTS signing_events_once_idx ON public.signing_events (envelope_id, signer_key, event)
  WHERE event IN ('signed', 'completed', 'declined', 'voided', 'certificate_issued', 'filed', 'consent_given', 'viewed');

CREATE OR REPLACE FUNCTION public.signing_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'signing_events is append-only' USING ERRCODE = '55000';
END $$;
DROP TRIGGER IF EXISTS signing_events_no_update ON public.signing_events;
CREATE TRIGGER signing_events_no_update BEFORE UPDATE OR DELETE ON public.signing_events
  FOR EACH ROW EXECUTE FUNCTION public.signing_events_append_only();

-- Service role only (the app always reads and writes through the server).
ALTER TABLE public.signing_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signing_envelopes, public.signing_events FROM anon, authenticated;

-- The consent the signer gave, stored WITH the signature (written in the same conditional update that saves it), only when
-- the company's consent step is on.
ALTER TABLE public.order_form_contracts
  ADD COLUMN IF NOT EXISTS consent_version text,
  ADD COLUMN IF NOT EXISTS consent_at timestamptz;
ALTER TABLE public.job_change_orders
  ADD COLUMN IF NOT EXISTS consent_version text,
  ADD COLUMN IF NOT EXISTS consent_at timestamptz;

SELECT pg_notify('pgrst', 'reload schema');
