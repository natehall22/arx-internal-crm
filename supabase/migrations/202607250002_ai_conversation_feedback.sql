-- ai_message_feedback: thumbs up/down per assistant message in AI chat.
--
-- Apply via Supabase MCP `apply_migration` before prod use — do NOT db push from local.
-- Rating only (up/down); no free-text to avoid retaining customer PII in feedback.

CREATE TABLE IF NOT EXISTS public.ai_message_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  message_index integer NOT NULL CHECK (message_index >= 0),
  rating text NOT NULL CHECK (rating IN ('up', 'down')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, message_index, user_id)
);

CREATE INDEX IF NOT EXISTS ai_message_feedback_conversation_idx
  ON public.ai_message_feedback (conversation_id);

ALTER TABLE public.ai_message_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own AI message feedback" ON public.ai_message_feedback;
CREATE POLICY "Users read own AI message feedback"
  ON public.ai_message_feedback FOR SELECT
  USING (
    user_id = auth.uid()
    AND org_id = public.get_user_org_id(auth.uid())
  );

DROP POLICY IF EXISTS "Users insert own AI message feedback" ON public.ai_message_feedback;
CREATE POLICY "Users insert own AI message feedback"
  ON public.ai_message_feedback FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND org_id = public.get_user_org_id(auth.uid())
  );

DROP POLICY IF EXISTS "Users delete own AI message feedback" ON public.ai_message_feedback;
CREATE POLICY "Users delete own AI message feedback"
  ON public.ai_message_feedback FOR DELETE
  USING (
    user_id = auth.uid()
    AND org_id = public.get_user_org_id(auth.uid())
  );

-- Upsert replaces rating on re-click; UPDATE policy lets users change their vote.
DROP POLICY IF EXISTS "Users update own AI message feedback" ON public.ai_message_feedback;
CREATE POLICY "Users update own AI message feedback"
  ON public.ai_message_feedback FOR UPDATE
  USING (
    user_id = auth.uid()
    AND org_id = public.get_user_org_id(auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    AND org_id = public.get_user_org_id(auth.uid())
  );
