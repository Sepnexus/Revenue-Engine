
-- Chat conversations table
CREATE TABLE public.chat_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  agent_key TEXT NOT NULL,
  period TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to chat_conversations"
ON public.chat_conversations FOR ALL
USING (has_role(auth.uid(), 'super_admin'))
WITH CHECK (has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Client users can view own org conversations"
ON public.chat_conversations FOR SELECT
USING (org_id = my_org_id(auth.uid()));

CREATE POLICY "Client users can insert own conversations"
ON public.chat_conversations FOR INSERT
WITH CHECK (org_id = my_org_id(auth.uid()) AND user_id = auth.uid());

CREATE POLICY "Client users can update own conversations"
ON public.chat_conversations FOR UPDATE
USING (org_id = my_org_id(auth.uid()) AND user_id = auth.uid());

-- Chat messages table
CREATE TABLE public.chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to chat_messages"
ON public.chat_messages FOR ALL
USING (has_role(auth.uid(), 'super_admin'))
WITH CHECK (has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Client users can view own org messages"
ON public.chat_messages FOR SELECT
USING (org_id = my_org_id(auth.uid()));

CREATE POLICY "Client users can insert own org messages"
ON public.chat_messages FOR INSERT
WITH CHECK (org_id = my_org_id(auth.uid()));

-- AI usage logs for token tracking and billing
CREATE TABLE public.ai_usage_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  conversation_id UUID REFERENCES public.chat_conversations(id) ON DELETE SET NULL,
  agent_key TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'gpt-4o',
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to ai_usage_logs"
ON public.ai_usage_logs FOR ALL
USING (has_role(auth.uid(), 'super_admin'))
WITH CHECK (has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Client users can view own org usage"
ON public.ai_usage_logs FOR SELECT
USING (org_id = my_org_id(auth.uid()));

CREATE POLICY "Service can insert ai_usage_logs"
ON public.ai_usage_logs FOR INSERT
WITH CHECK (true);

-- Indexes for performance
CREATE INDEX idx_chat_conversations_org ON public.chat_conversations(org_id);
CREATE INDEX idx_chat_conversations_user ON public.chat_conversations(user_id);
CREATE INDEX idx_chat_messages_conversation ON public.chat_messages(conversation_id);
CREATE INDEX idx_ai_usage_logs_org ON public.ai_usage_logs(org_id);
CREATE INDEX idx_ai_usage_logs_created ON public.ai_usage_logs(created_at);

-- Trigger for updated_at on conversations
CREATE TRIGGER update_chat_conversations_updated_at
BEFORE UPDATE ON public.chat_conversations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
