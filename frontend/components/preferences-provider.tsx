"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  DEFAULT_LANGUAGE,
  dictionaries,
  type Dictionary,
  type Language
} from "@/lib/i18n";

type Theme = "light" | "dark";

type PreferencesContextValue = {
  theme: Theme;
  language: Language;
  t: Dictionary;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setLanguage: (language: Language) => void;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function isLanguage(value: string | null): value is Language {
  return value === "en" || value === "id" || value === "zh-CN";
}

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark";
}

export function ThemeLanguageProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("vestalink-theme");
    const storedLanguage = window.localStorage.getItem("vestalink-language");
    if (isTheme(storedTheme)) setThemeState(storedTheme);
    if (isLanguage(storedLanguage)) setLanguageState(storedLanguage);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = language;
    window.localStorage.setItem("vestalink-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = language;
    window.localStorage.setItem("vestalink-language", language);
  }, [language]);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      theme,
      language,
      t: dictionaries[language],
      setTheme: setThemeState,
      toggleTheme: () => setThemeState((current) => (current === "light" ? "dark" : "light")),
      setLanguage: setLanguageState
    }),
    [language, theme]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error("usePreferences must be used within ThemeLanguageProvider");
  }
  return context;
}
