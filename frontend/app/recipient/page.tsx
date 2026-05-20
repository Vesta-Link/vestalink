"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import bs58 from "bs58";

import { StreamCard } from "@/components/stream-card";
import {
  PRIVY_CONFIGURED,
  useActiveSolanaWallet,
  useSignAndSendTransaction
} from "@/components/privy-provider";
import {
  buildWithdrawTransaction,
  fetchStreams,
  getConnection,
  prepareUnsignedTransaction,
  rawToDecimal,
  serializeTransactionError,
  type StreamView
} from "@/lib/vesting";

export default function RecipientPage() {
  if (!PRIVY_CONFIGURED) {
    return (
      <main className="page-shell single-column">
        <section className="panel">
          <p className="eyebrow">Recipient</p>
          <h1>Privy app ID required</h1>
          <p className="muted">
            Set NEXT_PUBLIC_PRIVY_APP_ID in frontend/.env.local to connect wallets and claim vested
            tokens.
          </p>
        </section>
      </main>
    );
  }

  return <RecipientPageInner />;
}

function RecipientPageInner() {
  const connection = useMemo(() => getConnection(), []);
  const { wallet, publicKey } = useActiveSolanaWallet();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const [streams, setStreams] = useState<StreamView[]>([]);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const recipientStreams = useMemo(() => {
    if (!publicKey) return [];
    return streams.filter((stream) => stream.account.recipient.equals(publicKey));
  }, [streams, publicKey]);

  const loadStreams = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStreams(await fetchStreams(connection));
    } catch (err) {
      setError(serializeTransactionError(err));
    } finally {
      setLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    void loadStreams();
  }, [loadStreams]);

  async function claim(stream: StreamView) {
    if (!wallet || !publicKey) {
      setError("Connect the recipient wallet first.");
      return;
    }

    setError("");
    setSuccess("");
    setClaiming(stream.publicKey.toBase58());
    try {
      const transaction = await buildWithdrawTransaction({
        connection,
        wallet: { publicKey },
        stream
      });
      const prepared = await prepareUnsignedTransaction({
        connection,
        transaction,
        feePayer: publicKey
      });
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
      setSuccess(`Claimed ${rawToDecimal(stream.claimableRaw, stream.decimals)} tokens.`);
      await loadStreams();
    } catch (err) {
      setError(serializeTransactionError(err));
    } finally {
      setClaiming("");
    }
  }

  return (
    <main className="page-shell single-column">
      <section className="panel dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recipient</p>
            <h1>Your vesting schedule</h1>
            <p className="muted">
              View locked, unlocked, and claimed tokens for streams assigned to your connected
              wallet.
            </p>
          </div>
          <button className="icon-button" type="button" onClick={loadStreams} aria-label="Refresh">
            <RefreshCw size={17} aria-hidden="true" />
          </button>
        </div>

        {error && <p className="message error">{error}</p>}
        {success && <p className="message success">{success}</p>}

        {loading ? (
          <div className="skeleton-list" aria-label="Loading streams">
            <span />
            <span />
            <span />
          </div>
        ) : recipientStreams.length === 0 ? (
          <div className="empty-state">
            <strong>No recipient streams found</strong>
            <p>Connect the wallet that was entered as the stream recipient.</p>
          </div>
        ) : (
          <div className="stream-list">
            {recipientStreams.map((stream) => {
              const isClaiming = claiming === stream.publicKey.toBase58();
              const disabled = stream.claimableRaw <= 0n || isClaiming || !stream.vault;

              return (
                <StreamCard
                  key={stream.publicKey.toBase58()}
                  stream={stream}
                  mode="recipient"
                  action={
                    <button
                      className="button primary compact"
                      type="button"
                      disabled={disabled}
                      onClick={() => claim(stream)}
                    >
                      {isClaiming ? "Claiming..." : "Claim"}
                    </button>
                  }
                />
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
