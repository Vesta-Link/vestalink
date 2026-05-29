"use client";

import { RefreshCw, Send, Coins } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import bs58 from "bs58";

import { StreamCard } from "@/components/stream-card";
import {
  PRIVY_CONFIGURED,
  useActiveSolanaWallet,
  useSignAndSendTransaction
} from "@/components/privy-provider";
import {
  buildCreateStreamTransaction,
  buildCancelStreamTransaction,
  fetchStreams,
  parseCsvRows,
  prepareUnsignedTransaction,
  getConnection,
  serializeTransactionError,
  buildMintTestTokensTransaction,
  type StreamView
} from "@/lib/vesting";
import { PublicKey } from "@solana/web3.js";

function defaultDate(minutesFromNow: number) {
  const date = new Date(Date.now() + minutesFromNow * 60 * 1000);
  date.setSeconds(0, 0);
  return date.toISOString().slice(0, 16);
}

export default function AdminPage() {
  if (!PRIVY_CONFIGURED) {
    return (
      <main className="page-shell single-column">
        <section className="panel">
          <p className="eyebrow">Admin</p>
          <h1>Privy app ID required</h1>
          <p className="muted">
            Set NEXT_PUBLIC_PRIVY_APP_ID in frontend/.env.local to connect wallets and create
            vesting streams.
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
  const [mint, setMint] = useState("");
  const [rows, setRows] = useState("");
  const [start, setStart] = useState(defaultDate(5));
  const [end, setEnd] = useState(defaultDate(60 * 24 * 30));
  const [cliff, setCliff] = useState("");
  const [preset, setPreset] = useState("");
  const [streams, setStreams] = useState<StreamView[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [canceling, setCanceling] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isMinting, setIsMinting] = useState(false);

  const adminStreams = useMemo(() => {
    if (!publicKey) return [];
    return streams.filter((stream) => stream.account.funder.equals(publicKey));
  }, [streams, publicKey]);

  const loadStreams = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      setStreams(await fetchStreams(connection));
    } catch (err) {
      setError(serializeTransactionError(err));
    } finally {
      setIsLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    void loadStreams();
  }, [loadStreams]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!wallet || !publicKey) {
      setError("Connect an admin wallet first.");
      return;
    }

    try {
      setIsSubmitting(true);
      const parsedRows = parseCsvRows(rows);
      const { transaction } = await buildCreateStreamTransaction({
        connection,
        wallet: { publicKey },
        mint: new PublicKey(mint.trim()),
        rows: parsedRows,
        startTime: Math.floor(new Date(start).getTime() / 1000),
        endTime: Math.floor(new Date(end).getTime() / 1000),
        cliffTime: cliff ? Math.floor(new Date(cliff).getTime() / 1000) : undefined
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
      setSuccess(`Created ${parsedRows.length} stream${parsedRows.length === 1 ? "" : "s"}.`);
      setRows("");
      await loadStreams();
    } catch (err) {
      setError(serializeTransactionError(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function cancel(stream: StreamView) {
    if (!wallet || !publicKey) return;
    if (!window.confirm("Are you sure you want to cancel this stream? Unvested tokens will be returned to you.")) return;
    setError("");
    setSuccess("");
    setCanceling(stream.publicKey.toBase58());
    try {
      const transaction = await buildCancelStreamTransaction({ connection, wallet: { publicKey }, stream });
      const prepared = await prepareUnsignedTransaction({ connection, transaction, feePayer: publicKey });
      const result = await signAndSendTransaction({ transaction: prepared.bytes, wallet, chain: "solana:devnet" });
      const signature = bs58.encode(result.signature);
      await connection.confirmTransaction({ signature, blockhash: prepared.blockhash, lastValidBlockHeight: prepared.lastValidBlockHeight }, "confirmed");
      setSuccess("Stream cancelled successfully.");
      await loadStreams();
    } catch (err) {
      setError(serializeTransactionError(err));
    } finally {
      setCanceling("");
    }
  }

  async function handleMintTestTokens() {
    if (!wallet || !publicKey) {
      setError("Connect an admin wallet first.");
      return;
    }
    setError("");
    setSuccess("");
    setIsMinting(true);
    try {
      const transaction = await buildMintTestTokensTransaction({ connection, wallet: { publicKey } });
      const prepared = await prepareUnsignedTransaction({ connection, transaction, feePayer: publicKey });
      const result = await signAndSendTransaction({ transaction: prepared.bytes, wallet, chain: "solana:devnet" });
      const signature = bs58.encode(result.signature);
      await connection.confirmTransaction({ signature, blockhash: prepared.blockhash, lastValidBlockHeight: prepared.lastValidBlockHeight }, "confirmed");
      setSuccess("Successfully minted 10,000 VESTA test tokens.");
    } catch (err) {
      setError(serializeTransactionError(err));
    } finally {
      setIsMinting(false);
    }
  }

  return (
    <main className="page-shell two-column">
      <section className="panel form-panel">
        <p className="eyebrow">Admin</p>
        <h1>Create vesting streams</h1>
        <p className="muted">
          Fund linear token streams from your connected wallet. Each recipient gets a PDA vault
          owned by the stream account.
        </p>

        <form className="stack" onSubmit={onSubmit} aria-busy={isSubmitting}>
          <div className="field">
            <label htmlFor="preset">Token preset</label>
            <select
              id="preset"
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value);
                if (e.target.value !== "") setMint(e.target.value);
              }}
            >
              <option value="4zFYPYxDAio8BDPqfpAWhEMzpyPANxJABmbWPmBq6LKx">VESTA test token</option>
              <option value="">Custom Mint</option>
            </select>
          </div>

          {preset === "4zFYPYxDAio8BDPqfpAWhEMzpyPANxJABmbWPmBq6LKx" && (
            <div className="stack" style={{ marginTop: "-8px" }}>
              <p className="hint">Devnet dummy SPL token for testing the vesting workflow.</p>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "16px",
                  border: "1px dashed var(--border)",
                  borderRadius: "var(--radius)",
                  backgroundColor: "var(--surface)",
                  marginTop: "-4px"
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <strong style={{ fontSize: "15px" }}>Need test tokens?</strong>
                  <p className="hint">Mint 10000 VESTA to your connected wallet.</p>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  disabled={isMinting}
                  onClick={handleMintTestTokens}
                >
                  <Coins size={16} aria-hidden="true" />
                  {isMinting ? "Requesting..." : "Request VESTA"}
                </button>
              </div>
            </div>
          )}

          <div className="field">
            <label htmlFor="mint">Token mint</label>
            <input
              id="mint"
              value={mint}
              onChange={(event) => {
                setMint(event.target.value);
                setPreset("");
              }}
              placeholder="Devnet SPL mint address"
              spellCheck={false}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="recipients">Recipients and amounts</label>
            <textarea
              id="recipients"
              value={rows}
              onChange={(event) => setRows(event.target.value)}
              placeholder={"wallet_address,1000\nwallet_address,250.5"}
              spellCheck={false}
              required
              rows={7}
            />
            <p className="hint">One recipient per line. Amounts use the mint decimals.</p>
          </div>

          <div className="field-grid">
            <div className="field">
              <label htmlFor="start">Start</label>
              <input
                id="start"
                type="datetime-local"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="end">End</label>
              <input
                id="end"
                type="datetime-local"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                required
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="cliff">Cliff (optional)</label>
            <input
              id="cliff"
              type="datetime-local"
              value={cliff}
              onChange={(event) => setCliff(event.target.value)}
            />
          </div>

          {error && <p className="message error">{error}</p>}
          {success && <p className="message success">{success}</p>}

          <button className="button primary full" type="submit" disabled={isSubmitting}>
            <Send size={16} aria-hidden="true" />
            {isSubmitting ? "Creating streams..." : "Create streams"}
          </button>
        </form>
      </section>

      <section className="panel dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h2>Claim status</h2>
          </div>
          <button className="icon-button" type="button" onClick={loadStreams} aria-label="Refresh">
            <RefreshCw size={17} aria-hidden="true" />
          </button>
        </div>

        {isLoading ? (
          <div className="skeleton-list" aria-label="Loading streams">
            <span />
            <span />
            <span />
          </div>
        ) : adminStreams.length === 0 ? (
          <div className="empty-state">
            <strong>No admin streams yet</strong>
            <p>Create a stream from this wallet to track recipients here.</p>
          </div>
        ) : (
          <div className="stream-list">
            {adminStreams.map((stream) => {
              const isCanceling = canceling === stream.publicKey.toBase58();
              return (
                <StreamCard
                  key={stream.publicKey.toBase58()}
                  stream={stream}
                  mode="admin"
                  action={
                    <button
                      className="button secondary compact"
                      type="button"
                      disabled={stream.status === "complete" || stream.status === "revoked" || isCanceling}
                      onClick={() => cancel(stream)}
                    >
                      {isCanceling ? "Canceling..." : "Cancel"}
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
