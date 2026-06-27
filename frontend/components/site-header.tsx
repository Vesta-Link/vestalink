"use client";

import { useState, useRef, useEffect } from "react";
import { Moon, Sun, ChevronDown } from "lucide-react";
import Link from "next/link";

import { ConnectButton } from "@/components/privy-provider";
import { usePreferences } from "@/components/preferences-provider";
import { LANGUAGES, type Language } from "@/lib/i18n";

function useClickOutside(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        handler();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [ref, handler]);
}

function NetworkDropdown({ t }: Readonly<{ t: any }>) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useClickOutside(dropdownRef, () => setIsOpen(false));

  return (
    <div className="custom-dropdown" ref={dropdownRef}>
      <button 
        type="button" 
        className="network-pill"
        style={{ cursor: "pointer", gap: "4px" }}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        {t.header.devnet}
        <ChevronDown size={14} style={{ opacity: 0.7 }} />
      </button>
      
      {isOpen && (
        <div className="custom-dropdown-menu" role="menu">
          <button type="button" role="menuitem" className="custom-dropdown-item selected">
            {t.header.devnet}
          </button>
          <button type="button" role="menuitem" className="custom-dropdown-item disabled" disabled>
            {t.header.mainnetComingSoon}
          </button>
        </div>
      )}
    </div>
  );
}

function LanguageDropdown({ 
  language, 
  setLanguage, 
  t 
}: Readonly<{ 
  language: Language;
  setLanguage: (lang: Language) => void;
  t: any;
}>) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useClickOutside(dropdownRef, () => setIsOpen(false));

  const selectedItem = LANGUAGES.find(item => item.code === language) || LANGUAGES[0];

  return (
    <div className="custom-dropdown language-select" ref={dropdownRef}>
      <button 
        type="button" 
        className="language-select-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={t.header.language}
      >
        <span>{selectedItem.label}</span>
        <ChevronDown size={14} style={{ opacity: 0.7 }} />
      </button>
      
      {isOpen && (
        <div className="custom-dropdown-menu" role="menu">
          {LANGUAGES.map((item) => (
            <button 
              key={item.code}
              type="button"
              role="menuitem" 
              className={`custom-dropdown-item ${item.code === language ? 'selected' : ''}`}
              onClick={() => {
                setLanguage(item.code);
                setIsOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SiteHeader() {
  const { theme, toggleTheme, language, setLanguage, t } = usePreferences();

  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="VestaLink home">
        <img className="brand-logo" src="/assets/vestalink-logo.png" alt="" aria-hidden="true" />
        <span>VestaLink</span>
      </Link>
      <nav className="nav-links" aria-label="Primary navigation">
        <Link href="/admin">{t.header.admin}</Link>
        <Link href="/recipient">{t.header.recipient}</Link>
      </nav>
      <div className="header-actions">
        <NetworkDropdown t={t} />
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
        <LanguageDropdown language={language} setLanguage={setLanguage} t={t} />
      </div>
    </header>
  );
}
