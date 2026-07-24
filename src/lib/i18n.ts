import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const pt = {
  common: {
    language: "Idioma",
    theme: "Tema",
    docs: "Documentação",
    support: "Suporte",
    signOut: "Sair",
    light: "Light",
    dark: "Dark",
    notifications: "Notificações",
    noNotifications: "Nenhuma notificação nova",
    youHaveNotifications_one: "Você tem {{count}} notificação",
    youHaveNotifications_other: "Você tem {{count}} notificações",
    markAllRead: "Marcar todas como lidas",
    confirmSignOut: "Deseja realmente sair?",
    enable: "Habilitar",
  },
};

const en = {
  common: {
    language: "Language",
    theme: "Theme",
    docs: "Documentation",
    support: "Support",
    signOut: "Sign out",
    light: "Light",
    dark: "Dark",
    notifications: "Notifications",
    noNotifications: "No new notifications",
    youHaveNotifications_one: "You have {{count}} notification",
    youHaveNotifications_other: "You have {{count}} notifications",
    markAllRead: "Mark all as read",
    confirmSignOut: "Are you sure you want to sign out?",
    enable: "Enable",
  },
};

if (!i18n.isInitialized) {
  const stored = typeof window !== "undefined" ? localStorage.getItem("advora.locale") : null;
  i18n.use(initReactI18next).init({
    resources: { "pt-BR": pt, "en-US": en },
    lng: stored ?? "pt-BR",
    fallbackLng: "pt-BR",
    defaultNS: "common",
    interpolation: { escapeValue: false },
  });
}

export const SUPPORTED_LOCALES = [
  { code: "pt-BR", label: "PT-BR", flag: "🇧🇷" },
  { code: "en-US", label: "EN-US", flag: "🇺🇸" },
] as const;

export default i18n;
