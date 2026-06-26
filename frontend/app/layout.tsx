import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";

import { SiteHeader } from "@/components/site-header";
import { ThemeLanguageProvider } from "@/components/preferences-provider";
import { PrivySolanaProvider } from "@/components/privy-provider";

import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-geist-sans"
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono"
});

export const metadata: Metadata = {
  title: "Vestalink",
  description: "Simple Solana token vesting streams for teams and recipients."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <body className={`${spaceGrotesk.variable} ${jetBrainsMono.variable}`}>
        <ThemeLanguageProvider>
          <PrivySolanaProvider>
            <SiteHeader />
            {children}
          </PrivySolanaProvider>
        </ThemeLanguageProvider>
      </body>
    </html>
  );
}
