-- Phase 1 / P2: persistent per-user limits for external provider calls.
-- Keeping one row per user/scope avoids unbounded event-log growth.

CREATE TABLE IF NOT EXISTS public.api_rate_limit_counters (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (user_id, scope)
);

ALTER TABLE public.api_rate_limit_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.api_rate_limit_counters FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.consume_rate_limit(_scope text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_limit integer;
  v_window_seconds integer;
  v_allowed boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  CASE _scope
    WHEN 'datajud_lookup' THEN v_limit := 20; v_window_seconds := 60;
    WHEN 'datajud_sync' THEN v_limit := 10; v_window_seconds := 60;
    WHEN 'zapi_status' THEN v_limit := 60; v_window_seconds := 60;
    WHEN 'zapi_qr_code' THEN v_limit := 10; v_window_seconds := 60;
    WHEN 'zapi_device' THEN v_limit := 60; v_window_seconds := 60;
    WHEN 'zapi_connection_action' THEN v_limit := 5; v_window_seconds := 900;
    WHEN 'zapi_send_text' THEN v_limit := 30; v_window_seconds := 60;
    WHEN 'copilot_prompt' THEN v_limit := 10; v_window_seconds := 600;
    ELSE RAISE EXCEPTION 'Unknown rate limit scope';
  END CASE;

  INSERT INTO public.api_rate_limit_counters AS counter (
    user_id, scope, window_started_at, request_count
  )
  VALUES (v_user_id, _scope, now(), 1)
  ON CONFLICT (user_id, scope) DO UPDATE
    SET window_started_at = CASE
          WHEN counter.window_started_at <= now() - make_interval(secs => v_window_seconds)
            THEN now()
          ELSE counter.window_started_at
        END,
        request_count = CASE
          WHEN counter.window_started_at <= now() - make_interval(secs => v_window_seconds)
            THEN 1
          ELSE counter.request_count + 1
        END
    WHERE counter.window_started_at <= now() - make_interval(secs => v_window_seconds)
       OR counter.request_count < v_limit
  RETURNING true INTO v_allowed;

  RETURN COALESCE(v_allowed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text) TO authenticated;
