-- ai_conversations: transcript storage for the read-only CRM AI assistant.
--
-- app/api/ai/chat/route.ts has always read and written this table, but it was
-- never created in prod, so every save silently failed and conversationId always
-- came back null. Creating it here so chat history actually persists.
--
-- The assistant is read-only and available to any authenticated user with
-- ai_enabled in Settings; this stores the transcript plus which record the chat
-- was opened from. Transcripts are personal: RLS scopes every operation to the
-- owning user, with org_id as a second fence so a stale/forged org_id can never
-- write across tenants.

CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  context_type text NOT NULL DEFAULT 'general'
    CHECK (context_type IN ('lead', 'opportunity', 'project', 'job', 'general')),
  context_id uuid,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Sidebar history lists the caller's most recent conversations.
CREATE INDEX IF NOT EXISTS ai_conversations_user_updated_idx
  ON public.ai_conversations (user_id, updated_at DESC);

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;

-- 017_commissions_ai_settings.sql created a permissive FOR ALL policy with only
-- user_id = auth.uid(); org-scoped policies OR with it, so drop the legacy one.
DROP POLICY IF EXISTS "Users can manage their AI conversations" ON public.ai_conversations;

DROP POLICY IF EXISTS "Users read own AI conversations" ON public.ai_conversations;
CREATE POLICY "Users read own AI conversations"
  ON public.ai_conversations FOR SELECT
  USING (
    user_id = auth.uid()
    AND org_id = public.get_user_org_id(auth.uid())
  );

DROP POLICY IF EXISTS "Users insert own AI conversations" ON public.ai_conversations;
CREATE POLICY "Users insert own AI conversations"
  ON public.ai_conversations FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND org_id = public.get_user_org_id(auth.uid())
  );

DROP POLICY IF EXISTS "Users update own AI conversations" ON public.ai_conversations;
CREATE POLICY "Users update own AI conversations"
  ON public.ai_conversations FOR UPDATE
  USING (
    user_id = auth.uid()
    AND org_id = public.get_user_org_id(auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    AND org_id = public.get_user_org_id(auth.uid())
  );

-- Users can clear their own history; nothing in the app deletes on their behalf.
DROP POLICY IF EXISTS "Users delete own AI conversations" ON public.ai_conversations;
CREATE POLICY "Users delete own AI conversations"
  ON public.ai_conversations FOR DELETE
  USING (
    user_id = auth.uid()
    AND org_id = public.get_user_org_id(auth.uid())
  );
