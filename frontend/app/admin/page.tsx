"use client";

import bs58 from "bs58";
import { RefreshCw, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { usePreferences } from "@/components/preferences-provider";
import { StreamCard } from "@/components/stream-card";
import {
  PRIVY_CONFIGURED,
  useActiveSolanaWallet,
  useSignAndSendTransaction
} from "@/components/privy-provider";
import {
  buildCancelStreamTransaction,
  buildUnlockMilestoneTransaction,
  buildUnlockGroupMilestoneTransaction,
  fetchStreams,
  getConnection,
  prepareUnsignedTransaction,
  serializeTransactionError,
  formatDateTime,
  type StreamView
} from "@/lib/vesting";

export default function AdminPage() {
  const { t } = usePreferences();

  if (!PRIVY_CONFIGURED) {
    return (
      <main className="page-shell single-column">
        <section className="panel">
          <p className="eyebrow">{t.header.admin}</p>
          <h1>{t.common.privyRequiredTitle}</h1>
          <p className="muted">{t.admin.privyRequired}</p>
        </section>
      </main>
    );
  }

  return <AdminPageInner />;
}

function AdminPageInner() {
  const { t } = usePreferences();
  const connection = useMemo(() => getConnection(), []);
  const { wallet, publicKey } = useActiveSolanaWallet();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  // Stream state
  const [streams, setStreams] = useState<StreamView[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState("");
  const [settingMilestoneId, setSettingMilestoneId] = useState("");
  const [settingGroupMilestoneId, setSettingGroupMilestoneId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [cancelConfirm, setCancelConfirm] = useState<StreamView | null>(null);

  const adminStreams = useMemo(() => {
    if (!publicKey) return [];
    return streams.filter((stream) => stream.account.funder.equals(publicKey));
  }, [streams, publicKey]);

  const groupedAdminStreams = useMemo(() => {
    if (adminStreams.length === 0) return [];
    const groups: Record<string, StreamView[]> = {};
    for (const stream of adminStreams) {
      // Group streams by common attributes set during batch creation
      const key = `${stream.account.startTime.toString()}-${stream.account.endTime.toString()}-${stream.account.cliffTime.toString()}-${JSON.stringify(stream.account.vestingType)}-${stream.mint?.toBase58()}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(stream);
    }
    // Sort groups descending by start time
    return Object.values(groups).sort((a, b) => b[0].account.startTime.toNumber() - a[0].account.startTime.toNumber());
  }, [adminStreams]);

  const loadStreams = useCallback(async () => {
    setIsLoading(true);
    try {
      setStreams(await fetchStreams(connection));
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    void loadStreams();
  }, [loadStreams]);

  async function runSignedTx(
    buildFn: () => Promise<{ bytes: Uint8Array; blockhash: string; lastValidBlockHeight: number }>
  ) {
    if (!wallet || !publicKey) throw new Error(t.create.connectWallet);
    const prepared = await buildFn();
    const result = await signAndSendTransaction({
      transaction: prepared.bytes,
      wallet,
      chain: "solana:devnet"
    });
    const signature = bs58.encode(result.signature);
    await connection.confirmTransaction(
      {
        signature,
        blockhash: prepared.blockhash,
        lastValidBlockHeight: prepared.lastValidBlockHeight
      },
      "confirmed"
    );
    return signature;
  }

  async function cancelStream(stream: StreamView) {
    setCancelConfirm(null);
    if (!wallet || !publicKey) {
      setError(t.create.connectWallet);
      return;
    }
    setError("");
    setSuccess("");
    setCancellingId(stream.publicKey.toBase58());
    try {
      const transaction = await buildCancelStreamTransaction({ connection, wallet: { publicKey }, stream });
      const signature = await runSignedTx(async () =>
        prepareUnsignedTransaction({ connection, transaction, feePayer: publicKey })
      );
      setSuccess(t.admin.cancelled.replace("{signature}", signature));
      await loadStreams();
    } catch (err) {
      setError(serializeTransactionError(err, t.errors));
    } finally {
      setCancellingId("");
    }
  }

  async function unlockMilestone(stream: StreamView) {
    if (!wallet || !publicKey) {
      setError(t.create.connectWallet);
      return;
    }
    setError("");
    setSuccess("");
    setSettingMilestoneId(stream.publicKey.toBase58());
    try {
      const transaction = await buildUnlockMilestoneTransaction({ connection, wallet: { publicKey }, stream });
      const signature = await runSignedTx(async () =>
        prepareUnsignedTransaction({ connection, transaction, feePayer: publicKey })
      );
      setSuccess(t.admin.milestoneUnlocked.replace("{signature}", signature));
      await loadStreams();
    } catch (err) {
      setError(serializeTransactionError(err, t.errors));
    } finally {
      setSettingMilestoneId("");
    }
  }

  async function unlockGroupMilestone(groupId: string, streams: StreamView[]) {
    if (!wallet || !publicKey) {
      setError(t.create.connectWallet);
      return;
    }
    setError("");
    setSuccess("");
    setSettingGroupMilestoneId(groupId);
    try {
      const transaction = await buildUnlockGroupMilestoneTransaction({ connection, wallet: { publicKey }, streams });
      const signature = await runSignedTx(async () =>
        prepareUnsignedTransaction({ connection, transaction, feePayer: publicKey })
      );
      setSuccess(t.admin.milestoneUnlocked.replace("{signature}", signature));
      await loadStreams();
    } catch (err) {
      setError(serializeTransactionError(err, t.errors));
    } finally {
      setSettingGroupMilestoneId("");
    }
  }

  let streamListContent;
  if (isLoading) {
    streamListContent = (
      <div className="skeleton-list" aria-label={t.common.loading}>
        <span />
        <span />
        <span />
      </div>
    );
  } else if (adminStreams.length === 0) {
    streamListContent = (
      <div className="empty-state">
        <strong>{t.admin.emptyTitle}</strong>
        <p>{t.admin.emptyText}</p>
        <Link href="/admin/create" className="button primary" style={{ marginTop: 16 }}>
          <Plus size={16} aria-hidden="true" /> {t.admin.createStream}
        </Link>
      </div>
    );
  } else {
    streamListContent = (
      <div className="stream-list-grouped" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {groupedAdminStreams.map((group) => {
          const firstStream = group[0];
          const recipientStr = group.length === 1 ? t.admin.groupRecipient : t.admin.groupRecipients;
          const groupTitle = `${formatDateTime(firstStream.account.startTime)} - ${recipientStr.replace("{count}", String(group.length))}`;
          
          let vestingTypeLabel: string = t.common.linear;
          if (typeof firstStream.account.vestingType === 'object' && firstStream.account.vestingType !== null) {
            if ('milestone' in firstStream.account.vestingType && firstStream.account.milestoneCount > 0) {
              vestingTypeLabel = t.common.milestone;
            } else if ('cliff' in firstStream.account.vestingType) {
              vestingTypeLabel = t.common.cliff;
            }
          }
          
          const unlockableStreams = group.filter((stream) => {
            const isMilestoneStream = typeof stream.account.vestingType === 'object' && stream.account.vestingType !== null && 'milestone' in stream.account.vestingType;
            return wallet && publicKey && isMilestoneStream && stream.account.authorityMilestone.equals(publicKey) && stream.account.milestonesReached < stream.account.milestoneCount && stream.status !== "revoked" && stream.status !== "complete";
          });
          const canUnlockGroup = unlockableStreams.length > 0;
          const isSettingGroupMilestone = settingGroupMilestoneId === firstStream.publicKey.toBase58();
          
          return (
            <div key={firstStream.publicKey.toBase58()} className="stream-group">
              <h3 style={{ marginBottom: '16px', fontSize: '1.1em', fontWeight: 600, paddingBottom: '8px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {groupTitle}
                  {canUnlockGroup && (
                    <button
                      className="button primary compact"
                      type="button"
                      disabled={isSettingGroupMilestone}
                      onClick={() => unlockGroupMilestone(firstStream.publicKey.toBase58(), unlockableStreams)}
                    >
                      {isSettingGroupMilestone ? t.streamCard.settingMilestone : t.admin.unlockGroup}
                    </button>
                  )}
                </span>
                <span className="token-label" style={{ fontSize: '0.85em', fontWeight: 'normal', color: 'var(--muted)' }}>
                  {firstStream.symbol} • {vestingTypeLabel}
                </span>
              </h3>
              <div className="stream-list">
                {group.map((stream) => {
                  const sid = stream.publicKey.toBase58();
                  const isCancelling = cancellingId === sid;
                  const isSettingMilestone = settingMilestoneId === sid;
                  const canCancel =
                    !stream.account.isRevoked &&
                    stream.status !== "complete" &&
                    stream.status !== "revoked" &&
                    !!stream.vault;
                  
                  const isMilestoneStream = typeof stream.account.vestingType === 'object' && stream.account.vestingType !== null && 'milestone' in stream.account.vestingType;
                  const canSetMilestone = wallet && publicKey && isMilestoneStream && stream.account.authorityMilestone.equals(publicKey) && stream.account.milestonesReached < stream.account.milestoneCount && stream.status !== "revoked" && stream.status !== "complete";

                  const milestoneAction = canSetMilestone ? (
                    <button
                      className="button primary compact"
                      type="button"
                      disabled={isSettingMilestone}
                      onClick={() => unlockMilestone(stream)}
                    >
                      {isSettingMilestone ? t.streamCard.settingMilestone : t.streamCard.setMilestone}
                    </button>
                  ) : undefined;

                  return (
                    <StreamCard
                      key={sid}
                      stream={stream}
                      mode="admin"
                      action={milestoneAction}
                      onCancel={canCancel ? () => setCancelConfirm(stream) : undefined}
                      isCancelling={isCancelling}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <>
      {(success || error) && (
        <div className={`toast ${success ? 'success' : 'error'}`} role="status" aria-live="polite">
          <div>
            <p>{success || error}</p>
          </div>
          <button type="button" onClick={() => { setSuccess(""); setError(""); }} aria-label={t.common.close}>
            {t.common.close}
          </button>
        </div>
      )}

      {cancelConfirm && (
        <dialog open className="modal-backdrop" aria-labelledby="cancel-dialog-title">
          <div className="modal-box">
            <h2 id="cancel-dialog-title">{t.admin.cancelTitle}</h2>
            <p>{t.admin.cancelText}</p>
            <div className="modal-actions">
              <button className="button secondary compact" type="button" onClick={() => setCancelConfirm(null)}>
                {t.admin.keepStream}
              </button>
              <button className="button primary compact" type="button" onClick={() => cancelStream(cancelConfirm)}>
                {t.admin.confirmCancel}
              </button>
            </div>
          </div>
        </dialog>
      )}

      <main className="page-shell single-column">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <p className="eyebrow">{t.admin.eyebrow}</p>
            <h1>{t.admin.title}</h1>
          </div>
          <Link href="/admin/create" className="button primary">
            <Plus size={16} aria-hidden="true" /> {t.admin.createStream}
          </Link>
        </div>

        <section className="panel dashboard-panel">
          <div className="section-heading">
            <div>
              <h2>{t.admin.sectionTitle}</h2>
              <p className="muted">{t.admin.sectionSubtitle}</p>
            </div>
            <button className="icon-button" type="button" onClick={loadStreams} aria-label={t.common.refresh}>
              <RefreshCw size={17} aria-hidden="true" />
            </button>
          </div>



          {streamListContent}
        </section>
      </main>
    </>
  );
}
