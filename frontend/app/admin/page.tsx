"use client";

import bs58 from "bs58";
import { RefreshCw, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { StreamCard } from "@/components/stream-card";
import {
  PRIVY_CONFIGURED,
  useActiveSolanaWallet,
  useSignAndSendTransaction
} from "@/components/privy-provider";
import {
  buildCancelStreamTransaction,
  fetchStreams,
  getConnection,
  prepareUnsignedTransaction,
  serializeTransactionError,
  type StreamView
} from "@/lib/vesting";

export default function AdminPage() {
  if (!PRIVY_CONFIGURED) {
    return (
      <main className="page-shell single-column">
        <section className="panel">
          <p className="eyebrow">Admin</p>
          <h1>Privy app ID required</h1>
          <p className="muted">
            Set NEXT_PUBLIC_PRIVY_APP_ID in frontend/.env.local to connect wallets and view streams.
          </p>
        </section>
      </main>
    );
  }

  return <AdminPageInner />;
}

function AdminPageInner() {
  const connection = useMemo(() => getConnection(), []);
  const { wallet, publicKey } = useActiveSolanaWallet();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  // Stream state
  const [streams, setStreams] = useState<StreamView[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [cancelConfirm, setCancelConfirm] = useState<StreamView | null>(null);

  const adminStreams = useMemo(() => {
    if (!publicKey) return [];
    return streams.filter((stream) => stream.account.funder.equals(publicKey));
  }, [streams, publicKey]);

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
    if (!wallet || !publicKey) throw new Error("Connect a wallet first.");
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
      setError("Connect a wallet first.");
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
      setSuccess(`Stream cancelled. Tx: ${signature}`);
      await loadStreams();
    } catch (err) {
      setError(serializeTransactionError(err));
    } finally {
      setCancellingId("");
    }
  }

  let streamListContent;
  if (isLoading) {
    streamListContent = (
      <div className="skeleton-list" aria-label="Loading streams">
        <span />
        <span />
        <span />
      </div>
    );
  } else if (adminStreams.length === 0) {
    streamListContent = (
      <div className="empty-state">
        <strong>No streams yet</strong>
        <p>Create a stream from this wallet to track recipients here.</p>
        <Link href="/admin/create" className="button primary" style={{ marginTop: 16 }}>
          <Plus size={16} /> Create Stream
        </Link>
      </div>
    );
  } else {
    streamListContent = (
      <div className="stream-list">
        {adminStreams.map((stream) => {
          const sid = stream.publicKey.toBase58();
          const isCancelling = cancellingId === sid;
          const canCancel =
            !stream.account.isRevoked &&
            stream.status !== "complete" &&
            stream.status !== "revoked" &&
            !!stream.vault;
          return (
            <StreamCard
              key={sid}
              stream={stream}
              mode="admin"
              onCancel={canCancel ? () => setCancelConfirm(stream) : undefined}
              isCancelling={isCancelling}
            />
          );
        })}
      </div>
    );
  }

  return (
    <>
      {cancelConfirm && (
        <dialog open className="modal-backdrop" aria-labelledby="cancel-dialog-title">
          <div className="modal-box">
            <h2 id="cancel-dialog-title">Cancel this stream?</h2>
            <p>
              Unvested tokens will be returned to your treasury account. This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="button secondary compact" type="button" onClick={() => setCancelConfirm(null)}>
                Keep stream
              </button>
              <button className="button primary compact" type="button" onClick={() => cancelStream(cancelConfirm)}>
                Yes, cancel stream
              </button>
            </div>
          </div>
        </dialog>
      )}

      <main className="page-shell single-column">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <p className="eyebrow">Dashboard</p>
            <h1>Admin Dashboard</h1>
          </div>
          <Link href="/admin/create" className="button primary">
            <Plus size={16} /> Create Stream
          </Link>
        </div>

        <section className="panel dashboard-panel">
          <div className="section-heading">
            <div>
              <h2>Streams you created</h2>
              <p className="muted">Manage and monitor your outgoing token streams.</p>
            </div>
            <button className="icon-button" type="button" onClick={loadStreams} aria-label="Refresh">
              <RefreshCw size={17} aria-hidden="true" />
            </button>
          </div>

          {error && <p className="message error" style={{ marginBottom: 16 }}>{error}</p>}
          {success && <p className="message success" style={{ marginBottom: 16 }}>{success}</p>}

          {streamListContent}
        </section>
      </main>
    </>
  );
}
