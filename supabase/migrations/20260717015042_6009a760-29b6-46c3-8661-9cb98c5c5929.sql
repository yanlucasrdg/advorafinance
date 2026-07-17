ALTER TABLE public.deadlines
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'media',
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS deadlines_tenant_due_idx ON public.deadlines(tenant_id, due_at);

CREATE OR REPLACE FUNCTION public.set_deadline_completed_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.done IS DISTINCT FROM OLD.done THEN
    NEW.completed_at := CASE WHEN NEW.done THEN now() ELSE NULL END;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_deadlines_completed ON public.deadlines;
CREATE TRIGGER trg_deadlines_completed BEFORE UPDATE ON public.deadlines
  FOR EACH ROW EXECUTE FUNCTION public.set_deadline_completed_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.deadlines;