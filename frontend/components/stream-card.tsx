import { ExternalLink } from "lucide-react";

import { StatusPill } from "@/components/status-pill";
import {
  explorerUrl,
  formatDateTime,
  rawToDecimal,
  shorten,
  type StreamView
} from "@/lib/vesting";

function formatTimeRemaining(endTime: { toNumber: () => number }) {
  const now = Math.floor(Date.now() / 1000);
  const end = endTime.toNumber();
  const diff = end - now;
  if (diff <= 0) return "Ended";
  const days = Math.floor(diff / 86_400);
  const hours = Math.floor((diff % 86_400) / 3_600);
  const minutes = Math.floor((diff % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function StreamCard({
  stream,
  mode,
  action,
  onCancel,
  isCancelling
}: Readonly<{
  stream: StreamView;
  mode: "admin" | "recipient";
  action?: React.ReactNode;
  onCancel?: () => void;
  isCancelling?: boolean;
}>) {
  const { account } = stream;
  const counterparty = mode === "admin" ? account.recipient : account.funder;
  const claimed = rawToDecimal(account.claimedAmount, stream.decimals);
  const total = rawToDecimal(account.totalAmount, stream.decimals);
  const claimable = rawToDecimal(stream.claimableRaw, stream.decimals);

  const canCancel =
    onCancel &&
    !stream.account.isRevoked &&
    stream.status !== "complete" &&
    stream.status !== "revoked";

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
          <span className="label">Claimed</span>
          <strong>{claimed}</strong>
        </div>
        <div>
          <span className="label">Claimable</span>
          <strong>{claimable}</strong>
        </div>
        <div>
          <span className="label">Remaining</span>
          <strong>{formatTimeRemaining(account.endTime)}</strong>
        </div>
      </div>

      <div className="schedule-row">
        <span>{formatDateTime(account.startTime)}</span>
        <span>{formatDateTime(account.endTime)}</span>
      </div>

      <div className="stream-footer">
        <span className="token-label">{stream.symbol}</span>
        <div className="stream-footer-actions">
          {canCancel && (
            <button
              className="button secondary compact"
              type="button"
              disabled={isCancelling}
              onClick={onCancel}
            >
              {isCancelling ? "Cancelling…" : "Cancel"}
            </button>
          )}
          {action}
        </div>
      </div>
    </article>
  );
}
