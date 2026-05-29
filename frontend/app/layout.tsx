import type { Metadata } from "next";
import Link from "next/link";

import { ConnectButton, PrivySolanaProvider } from "@/components/privy-provider";
import { PROGRAM_ID, shorten } from "@/lib/vesting";

import "./globals.css";

export const metadata: Metadata = {
  title: "Vestalink",
  description: "Simple Solana token vesting streams for teams and recipients."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <PrivySolanaProvider>
          <header className="site-header">
            <Link href="/" className="brand" aria-label="Vestalink home">
              Vestalink
            </Link>
            <nav className="nav-links" aria-label="Primary navigation">
              <Link href="/admin">Admin</Link>
              <Link href="/recipient">Recipient</Link>
            </nav>
            <div className="header-actions">
              <span className="network-pill">Devnet</span>
              {/* <span className="program-pill" title={PROGRAM_ID.toBase58()}>
                {shorten(PROGRAM_ID)}
              </span> */}
              <ConnectButton />
            </div>
          </header>
          {children}
        </PrivySolanaProvider>
      </body>
    </html>
  );
}
