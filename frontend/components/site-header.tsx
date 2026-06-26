"use client";

import { Moon, Sun } from "lucide-react";
import Link from "next/link";

import { ConnectButton } from "@/components/privy-provider";
import { usePreferences } from "@/components/preferences-provider";
import { LANGUAGES, type Language } from "@/lib/i18n";

export function SiteHeader() {
  const { theme, toggleTheme, language, setLanguage, t } = usePreferences();

  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="Vestalink home">
        <img className="brand-logo" src="/assets/vestalink-logo.png" alt="" aria-hidden="true" />
        <span>Vestalink</span>
      </Link>
      <nav className="nav-links" aria-label="Primary navigation">
        <Link href="/admin">{t.header.admin}</Link>
        <Link href="/recipient">{t.header.recipient}</Link>
      </nav>
      <div className="header-actions">
        <span className="network-pill">{t.header.devnet}</span>
        <ConnectButton />
        <button
          className="icon-button"
          type="button"
          onClick={toggleTheme}
          aria-label={t.header.toggleTheme}
          title={t.header.toggleTheme}
        >
          {theme === "light" ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}
        </button>
        <label className="language-select">
          <span className="sr-only">{t.header.language}</span>
          <select
            aria-label={t.header.language}
            value={language}
            onChange={(event) => setLanguage(event.target.value as Language)}
          >
            {LANGUAGES.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}
