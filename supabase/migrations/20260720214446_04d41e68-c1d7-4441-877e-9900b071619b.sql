
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'pt-BR',
  ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'dark';

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS link_action text,
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'info';

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, read_at) WHERE read_at IS NULL;
