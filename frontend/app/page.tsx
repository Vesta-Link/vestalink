import Link from "next/link";

export default function Home() {
  return (
    <main className="page-shell home-grid">
      <section className="intro">
        <p className="eyebrow">Solana token streams</p>
        <h1>Lock tokens once. Let recipients claim as they vest.</h1>
        <p>
          Vestalink creates linear token streams on devnet. Admins fund schedules, recipients
          claim only what has unlocked, and both sides can track the stream state.
        </p>
        <div className="action-row">
          <Link className="button primary" href="/admin">
            Open admin
          </Link>
          <Link className="button secondary" href="/recipient">
            Open recipient
          </Link>
        </div>
      </section>
      <section className="panel proof-panel" aria-label="Deployment status">
        <div>
          <span className="label">Program</span>
          <strong>Deployed on devnet</strong>
        </div>
        <div>
          <span className="label">Vesting</span>
          <strong>Linear unlock</strong>
        </div>
        <div>
          <span className="label">Vault</span>
          <strong>PDA-owned SPL token account</strong>
        </div>
      </section>
    </main>
  );
}
