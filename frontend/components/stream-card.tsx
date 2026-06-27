import { ExternalLink } from "lucide-react";

import { usePreferences } from "@/components/preferences-provider";
import { StatusPill } from "@/components/status-pill";
import {
  explorerUrl,
  formatDateTime,
  rawToDecimal,
  type StreamView
} from "@/lib/vesting";

function formatTimeRemaining(endTime: { toNumber: () => number }, endedLabel: string, units: { d: string, h: string, m: string }) {
  const now = Math.floor(Date.now() / 1000);
  const end = endTime.toNumber();
  const diff = end - now;
  if (diff <= 0) return endedLabel;
  const days = Math.floor(diff / 86_400);
  const hours = Math.floor((diff % 86_400) / 3_600);
  const minutes = Math.floor((diff % 3_600) / 60);
  if (days > 0) return `${days}${units.d} ${hours}${units.h}`;
  if (hours > 0) return `${hours}${units.h} ${minutes}${units.m}`;
  return `${minutes}${units.m}`;
}

function shortAddress(address: string) {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
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
  const { t } = usePreferences();
  const { account } = stream;
  const counterparty = mode === "admin" ? account.recipient : account.funder;
  const claimed = rawToDecimal(account.claimedAmount, stream.decimals);
  const total = rawToDecimal(account.totalAmount, stream.decimals);
  const claimableRaw = stream.claimableRaw;
  const claimable = rawToDecimal(claimableRaw, stream.decimals);

  const canCancel =
    onCancel &&
    !stream.account.isRevoked &&
    stream.status !== "complete" &&
    stream.status !== "revoked";

  const percent = Math.min(stream.progress, 100);
  const hasClaimable = claimableRaw > 0n;

  let vestingTypeLabel = ` • ${t.common.linear}`;
  let isCliff = false;
  if (typeof stream.account.vestingType === 'object' && stream.account.vestingType !== null) {
    if ('milestone' in stream.account.vestingType && stream.account.milestoneCount > 0) {
      vestingTypeLabel = ` • ${t.common.milestone} (${stream.account.milestonesReached}/${stream.account.milestoneCount})`;
    } else if ('cliff' in stream.account.vestingType) {
      vestingTypeLabel = ` • ${t.common.cliff}`;
      isCliff = true;
    }
  }

  const tokenDisplay = stream.name ? `${stream.name} (${stream.symbol})` : stream.symbol;

  return (
    <article className="stream-card" style={hasClaimable && mode === "recipient" ? { borderColor: "var(--accent)", boxShadow: "var(--accent-glow)" } : {}}>
      <div className="stream-card-top">
        <div style={{ minWidth: 0, maxWidth: '100%' }}>
          <p className="label">{mode === "admin" ? t.streamCard.recipient : t.streamCard.funder}</p>
          <a
            className="address-link"
            href={explorerUrl(counterparty.toBase58())}
            target="_blank"
            rel="noreferrer"
            style={{ maxWidth: '100%' }}
            title={counterparty.toBase58()}
          >
            <span className="address-full">
              {counterparty.toBase58()}
            </span>
            <span className="address-short">
              {shortAddress(counterparty.toBase58())}
            </span>
            <ExternalLink size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
          </a>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <StatusPill status={stream.status} />
          <a
            href={explorerUrl(stream.publicKey.toBase58())}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--muted)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 }}
          >
            {t.streamCard.viewStream} <ExternalLink size={10} aria-hidden="true" />
          </a>
        </div>
      </div>

      {/* Progress Visualization */}
      <div className="progress-section" style={{ margin: '16px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
          <span style={{ color: 'var(--muted)' }}>{t.common.progress}</span>
          <span style={{ fontWeight: 600 }}>{percent.toFixed(2)}%</span>
        </div>
        <div className="progress-track" aria-label={`${percent.toFixed(2)}% ${t.common.unlocked}`} style={{ height: 8, background: 'var(--surface-strong)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
          <span
            style={{
              display: 'block',
              height: '100%',
              width: `${percent}%`,
              background: 'linear-gradient(90deg, var(--foreground), var(--accent))',
              borderRadius: 4,
              transition: 'width 1s linear',
              position: 'relative'
            }}
          >
            {stream.status === "active" && (
              <span className="shimmer-effect" style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
                animation: 'shimmer-slide 2s infinite linear'
              }} />
            )}
          </span>
        </div>
      </div>

      <div className="metric-grid">
        <div>
          <span className="label">{t.common.total}</span>
          <strong>{total}</strong>
        </div>
        <div>
          <span className="label">{t.common.unlocked}</span>
          <strong>{rawToDecimal(stream.unlockedRaw, stream.decimals)}</strong>
        </div>
        <div>
          <span className="label">{t.common.claimed}</span>
          <strong>{claimed}</strong>
        </div>
        <div>
          <span className="label">{t.common.claimable}</span>
          <strong style={hasClaimable ? { color: 'var(--accent)' } : {}}>{claimable}</strong>
        </div>
        <div>
          <span className="label">{t.common.remaining}</span>
          <strong>{formatTimeRemaining(account.endTime, t.streamCard.ended, { d: t.common.dayUnit, h: t.common.hourUnit, m: t.common.minuteUnit })}</strong>
        </div>
      </div>

      <div className="schedule-row">
        <span>{formatDateTime(account.startTime)}</span>
        {isCliff && (
          <span style={{ color: 'var(--accent)', textAlign: 'center' }}>
            {t.create.cliffTime}: {formatDateTime(account.cliffTime)}
          </span>
        )}
        <span>{formatDateTime(account.endTime)}</span>
      </div>

      <div className="stream-footer">
        <span className="token-label">
          {stream.mint ? (
            <a
              href={explorerUrl(stream.mint.toBase58())}
              target="_blank"
              rel="noreferrer"
              style={{ color: "inherit", textDecoration: "none" }}
              title="View on Explorer"
            >
              {tokenDisplay}
              <ExternalLink size={12} aria-hidden="true" style={{ display: 'inline', verticalAlign: 'baseline', marginLeft: 4, marginRight: 4 }} />
            </a>
          ) : (
            tokenDisplay
          )}
          {vestingTypeLabel}
        </span>
        <div className="stream-footer-actions">
          {canCancel && (
            <button
              className="button secondary compact"
              type="button"
              disabled={isCancelling}
              onClick={onCancel}
            >
              {isCancelling ? t.streamCard.cancelling : t.streamCard.cancel}
            </button>
          )}
          {action}
        </div>
      </div>
    </article>
  );
}
