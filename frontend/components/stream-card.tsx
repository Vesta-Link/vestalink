import { ExternalLink } from "lucide-react";

import { StatusPill } from "@/components/status-pill";
import {
  explorerUrl,
  formatDateTime,
  rawToDecimal,
  shorten,
  type StreamView
} from "@/lib/vesting";

export function StreamCard({
  stream,
  mode,
  action
}: {
  stream: StreamView;
  mode: "admin" | "recipient";
  action?: React.ReactNode;
}) {
  const { account } = stream;
  const counterparty = mode === "admin" ? account.recipient : account.funder;
  const claimed = rawToDecimal(account.claimedAmount, stream.decimals);
  const total = rawToDecimal(account.totalAmount, stream.decimals);

  return (
    <article className="stream-card">
      <div className="stream-card-top">
        <div>
          <p className="label">{mode === "admin" ? "Recipient" : "Funder"}</p>
          <a
            className="address-link"
            href={explorerUrl(counterparty.toBase58())}
            target="_blank"
            rel="noreferrer"
          >
            {shorten(counterparty)}
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        </div>
        <StatusPill status={stream.status} />
      </div>

      <div className="progress-track" aria-label={`${stream.progress.toFixed(2)}% unlocked`}>
        <span style={{ width: `${Math.min(stream.progress, 100)}%` }} />
      </div>

      <div className="metric-grid">
        <div>
          <span className="label">Total</span>
          <strong>{total}</strong>
        </div>
        <div>
          <span className="label">Unlocked</span>
          <strong>{rawToDecimal(stream.unlockedRaw, stream.decimals)}</strong>
        </div>
        <div>
          <span className="label">Locked</span>
          <strong>{rawToDecimal(stream.lockedRaw, stream.decimals)}</strong>
        </div>
        <div>
          <span className="label">Claimed</span>
          <strong>{claimed}</strong>
        </div>
      </div>

      <div className="schedule-row">
        <span>{formatDateTime(account.startTime)}</span>
        <span>{formatDateTime(account.endTime)}</span>
      </div>

      <div className="stream-footer">
        <span className="token-label">{stream.symbol}</span>
        {action}
      </div>
    </article>
  );
}
