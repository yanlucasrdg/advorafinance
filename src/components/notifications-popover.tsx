import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Bell, AlertTriangle, Info, CheckCircle2, ExternalLink } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useRealtimeTables } from "@/hooks/use-realtime-table";

type Notification = {
  id: string;
  title: string;
  body: string | null;
  kind: string;
  severity: string | null;
  link_action: string | null;
  read_at: string | null;
  created_at: string;
};

const severityMeta: Record<string, { icon: typeof Info; bg: string; color: string }> = {
  info: { icon: Info, bg: "bg-blue-500/15", color: "text-blue-500" },
  success: { icon: CheckCircle2, bg: "bg-emerald-500/15", color: "text-emerald-500" },
  warning: { icon: AlertTriangle, bg: "bg-amber-500/15", color: "text-amber-500" },
  error: { icon: AlertTriangle, bg: "bg-rose-500/15", color: "text-rose-500" },
};

export function NotificationsPopover() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  useRealtimeTables(["notifications"], ["notif-bell"]);

  const load = async () => {
    if (!profile?.tenant_id) return;
    const { data } = await supabase
      .from("notifications")
      .select("id, title, body, kind, severity, link_action, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    setItems((data ?? []) as Notification[]);
  };

  useEffect(() => { load(); }, [profile?.tenant_id]);
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [profile?.tenant_id]);

  const unread = items.filter(i => !i.read_at);

  const markAllRead = async () => {
    const ids = unread.map(i => i.id);
    if (ids.length === 0) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() } as never).in("id", ids);
    load();
  };

  const countMsg = items.length === 0
    ? t("noNotifications")
    : t("youHaveNotifications", { count: items.length });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="size-9 grid place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground relative" aria-label={t("notifications")}>
          <Bell className="size-[16px]" strokeWidth={1.75} />
          {unread.length > 0 && (
            <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-emerald-500 ring-2 ring-background" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[380px] p-0 bg-popover border-border">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">{t("notifications")}</div>
            <div className="text-xs text-muted-foreground">{countMsg}</div>
          </div>
          {unread.length > 0 && (
            <button onClick={markAllRead} className="text-[11px] text-primary hover:underline">
              {t("markAllRead")}
            </button>
          )}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {items.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">{t("noNotifications")}</div>
          ) : (
            items.map(n => {
              const meta = severityMeta[n.severity ?? "info"] ?? severityMeta.info;
              const Icon = meta.icon;
              const unread = !n.read_at;
              return (
                <div key={n.id} className={`flex gap-3 px-4 py-3 border-b border-border/40 last:border-0 relative ${unread ? "bg-secondary/40" : ""}`}>
                  {unread && <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-emerald-500" />}
                  <div className={`shrink-0 grid place-items-center size-8 rounded-full ${meta.bg}`}>
                    <Icon className={`size-4 ${meta.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold leading-tight">{n.title}</div>
                    {n.body && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</div>}
                    {n.link_action && (
                      <Link
                        to={n.link_action as never}
                        onClick={() => setOpen(false)}
                        className="mt-2 inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-emerald-500 text-white text-[11px] font-medium hover:bg-emerald-600"
                      >
                        {t("enable")}<ExternalLink className="size-3" />
                      </Link>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
