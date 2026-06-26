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

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  title: "Vestalink",
  description: "Simple Solana token vesting streams for teams and recipients.",
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: "Vestalink",
    description: "Simple Solana token vesting streams for teams and recipients.",
    siteName: "Vestalink",
    images: [
      {
        url: "/assets/vestalink-og.png",
        width: 1536,
        height: 1024,
        alt: "Vestalink token streaming preview"
      }
    ],
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "Vestalink",
    description: "Simple Solana token vesting streams for teams and recipients.",
    images: ["/assets/vestalink-og.png"]
  }
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
