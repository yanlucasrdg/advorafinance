import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Languages, BookOpen, LifeBuoy, LogOut, Sun, Moon, ChevronDown, Check } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SUPPORTED_LOCALES } from "@/lib/i18n";
import i18n from "@/lib/i18n";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  localStorage.setItem("advora.theme", theme);
}

function applyLocale(locale: string) {
  i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
  localStorage.setItem("advora.locale", locale);
}

export function UserMenu() {
  const { profile, user, signOut, refreshProfile } = useAuth();
  const { t, i18n: i18next } = useTranslation();
  const navigate = useNavigate();
  const [langOpen, setLangOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() =>
    (typeof window !== "undefined" && (localStorage.getItem("advora.theme") as Theme)) || "dark",
  );

  // Hydrate from profile once loaded
  useEffect(() => {
    if (!profile) return;
    if (profile.locale && profile.locale !== i18next.language) applyLocale(profile.locale);
    if (profile.theme && profile.theme !== theme) { setTheme(profile.theme); applyTheme(profile.theme); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  useEffect(() => { applyTheme(theme); }, [theme]);

  const initials = (profile?.full_name ?? profile?.email ?? "?")
    .split(" ").map(s => s[0]).slice(0, 2).join("").toUpperCase();

  const persistLocale = async (loc: string) => {
    applyLocale(loc);
    setLangOpen(false);
    if (user?.id) {
      await supabase.from("profiles").update({ locale: loc } as never).eq("id", user.id);
      refreshProfile();
    }
  };

  const persistTheme = async (next: Theme) => {
    setTheme(next);
    if (user?.id) {
      await supabase.from("profiles").update({ theme: next } as never).eq("id", user.id);
      refreshProfile();
    }
  };

  const doSignOut = async () => { await signOut(); navigate({ to: "/auth" }); };

  const current = SUPPORTED_LOCALES.find(l => l.code === i18next.language) ?? SUPPORTED_LOCALES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 h-9 pl-1 pr-2 rounded-lg hover:bg-secondary transition-colors"
          aria-label="Menu do usuário"
        >
          <Avatar className="size-7">
            {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt={profile.full_name ?? ""} />}
            <AvatarFallback className="text-[11px] bg-[image:var(--gradient-brand)] text-white font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-72 p-0 bg-popover border-border">
        <div className="px-4 pt-4 pb-3 border-b border-border">
          <div className="text-sm font-semibold truncate">{profile?.full_name ?? "Usuário"}</div>
          <div className="text-xs text-muted-foreground truncate">{profile?.email}</div>
        </div>

        <div className="py-1">
          {/* Language */}
          <div className="px-2">
            <button
              onClick={() => setLangOpen(v => !v)}
              className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-md hover:bg-secondary text-sm"
            >
              <Languages className="size-4 text-muted-foreground" />
              <span className="flex-1 text-left">{t("language")}</span>
              <span className={`inline-flex items-center gap-1.5 h-7 px-2 rounded-md border text-xs font-medium transition-colors ${langOpen ? "border-emerald-500 text-emerald-500" : "border-border"}`}>
                <span>{current.flag}</span>
                <span>{current.label}</span>
                <ChevronDown className="size-3" />
              </span>
            </button>
            {langOpen && (
              <div className="mt-1 mb-1 rounded-md border border-border bg-card overflow-hidden">
                {SUPPORTED_LOCALES.map(l => {
                  const active = l.code === i18next.language;
                  return (
                    <button
                      key={l.code}
                      onClick={() => persistLocale(l.code)}
                      className={`w-full flex items-center gap-2 px-3 h-9 text-xs hover:bg-secondary ${active ? "bg-secondary/60 font-medium" : ""}`}
                    >
                      <span>{l.flag}</span>
                      <span>{l.label}</span>
                      {active && <Check className="ml-auto size-3.5 text-emerald-500" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Theme */}
          <div className="px-2">
            <div className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-md text-sm">
              <Moon className="size-4 text-muted-foreground" />
              <span className="flex-1 text-left">{t("theme")}</span>
              <div className="inline-flex items-center rounded-md border border-border p-0.5">
                <button
                  onClick={() => persistTheme("light")}
                  className={`inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium ${theme === "light" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
                >
                  <Sun className="size-3" />{t("light")}
                </button>
                <button
                  onClick={() => persistTheme("dark")}
                  className={`inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium ${theme === "dark" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
                >
                  <Moon className="size-3" />{t("dark")}
                </button>
              </div>
            </div>
          </div>

          {/* Docs */}
          <div className="px-2">
            <a
              href="mailto:hello@metaforge.studio?subject=Documentação%20Advora"
              className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-md hover:bg-secondary text-sm"
            >
              <BookOpen className="size-4 text-muted-foreground" />
              <span>{t("docs")}</span>
            </a>
          </div>

          {/* Support */}
          <div className="px-2">
            <a
              href="mailto:hello@metaforge.studio?subject=Suporte%20Advora"
              className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-md hover:bg-secondary text-sm"
            >
              <LifeBuoy className="size-4 text-muted-foreground" />
              <span>{t("support")}</span>
            </a>
          </div>
        </div>

        <div className="border-t border-border py-1 px-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="w-full flex items-center gap-2.5 px-2.5 h-10 rounded-md hover:bg-destructive/10 text-sm text-destructive">
                <LogOut className="size-4" />
                <span>{t("signOut")}</span>
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("signOut")}</AlertDialogTitle>
                <AlertDialogDescription>{t("confirmSignOut")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={doSignOut} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  {t("signOut")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
