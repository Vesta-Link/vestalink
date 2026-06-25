import Link from "next/link";
import { ArrowRight, CheckCircle, Clock, Database, Layers, Coins } from "lucide-react";

export default function Home() {
  return (
    <main className="page-shell">
      {/* Hero Section */}
      <section className="intro hero-section">
        <p className="eyebrow">Solana token streams</p>
        <h1>Stream token distributions on Solana.</h1>
        <p>
          Create vesting streams for rewards, grants, bounties, and contributors.
          Lock tokens once, let recipients claim.
        </p>
        <div className="action-row">
          <Link className="button primary" href="/admin/create">
            Create a Stream
          </Link>
          <Link className="button secondary" href="/recipient">
            Claim Tokens
          </Link>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="landing-section">
        <div className="section-header">
          <p className="eyebrow">How It Works</p>
          <h2>Token vesting, simplified.</h2>
        </div>

        <div className="steps-grid">
          <div className="step-card">
            <div className="step-icon"><CheckCircle size={24} /></div>
            <h3>1. Configure Stream</h3>
            <p>Input recipient, token amount, and schedule. Connect your wallet via Privy.</p>
          </div>
          <div className="step-card">
            <div className="step-icon"><Database size={24} /></div>
            <h3>2. Lock Tokens in Vault</h3>
            <p>Tokens are securely moved to a PDA-owned SPL token account.</p>
          </div>
          <div className="step-card">
            <div className="step-icon"><ArrowRight size={24} /></div>
            <h3>3. Share Claim Link</h3>
            <p>Generate a direct link for recipients to track and claim their stream.</p>
          </div>
          <div className="step-card">
            <div className="step-icon"><Clock size={24} /></div>
            <h3>4. Recipient Claims</h3>
            <p>Recipients call the claim instruction to unlock their vested amount over time.</p>
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section className="landing-section surface-section">
        <div className="section-header">
          <p className="eyebrow">Use Cases</p>
          <h2>Built for teams and DAOs.</h2>
        </div>

        <div className="use-case-grid">
          <div className="use-case-card panel">
            <Layers size={28} className="use-case-icon" />
            <h3>Oracle Node Rewards</h3>
            <p>Distribute node rewards to multiple operators simultaneously. Setup a stream and let recipients claim on their own schedule.</p>
          </div>
          <div className="use-case-card panel">
            <Coins size={28} className="use-case-icon" />
            <h3>Contributor and Bounty Payouts</h3>
            <p>Pay contributors, bounty hunters, or builders gradually without manual transfers. Monitor the payout status from the dashboard.</p>
          </div>
          <div className="use-case-card panel">
            <CheckCircle size={28} className="use-case-icon" />
            <h3>Grant Distribution</h3>
            <p>Represent grant vesting with a stream. Claimable amount is determined by schedule, leaving a perfect audit trail.</p>
          </div>
          <div className="use-case-card panel">
            <Clock size={28} className="use-case-icon" />
            <h3>Team Token Vesting</h3>
            <p>Allocate team tokens with linear vesting based on start and end times. Tokens are securely locked until unlocked.</p>
          </div>
        </div>
      </section>

      {/* Audit Trail Section */}
      <section className="landing-section">
        <div className="section-header">
          <p className="eyebrow">Transparency</p>
          <h2>On-chain Audit Trail.</h2>
          <p className="muted">
            Every action produces a verifiable transaction signature on Solana. Both senders and recipients can verify stream status anytime.
          </p>
        </div>

        <div className="audit-timeline panel">
          <div className="timeline-item">
            <div className="timeline-dot success"></div>
            <div className="timeline-content">
              <strong>Stream created & Tokens locked</strong>
              <span>Transaction verified on Explorer</span>
            </div>
          </div>
          <div className="timeline-item">
            <div className="timeline-dot active"></div>
            <div className="timeline-content">
              <strong>Vesting in progress</strong>
              <span>Tokens unlocking linearly</span>
            </div>
          </div>
          <div className="timeline-item">
            <div className="timeline-dot pending"></div>
            <div className="timeline-content">
              <strong>Recipient claimed</strong>
              <span>Partial tokens claimed by recipient</span>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="final-cta">
        <h2>Ready to create a token stream?</h2>
        <p className="muted">Create a stream or open the recipient claim page.</p>
        <div className="action-row justify-center">
          <Link className="button primary" href="/admin/create">
            Create a Stream
          </Link>
          <Link className="button secondary" href="/recipient">
            Open Recipient Page
          </Link>
        </div>
      </section>
    </main>
  );
}
