"use client";

import { Coins, RefreshCw, Send } from "lucide-react";
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
  buildRequestVestaTransaction,
  explorerUrl,
  fetchStreams,
  parseCsvRows,
  prepareUnsignedTransaction,
  getConnection,
  serializeTransactionError,
  VESTA_FAUCET_AMOUNT,
  type StreamView
} from "@/lib/vesting";
import { PublicKey } from "@solana/web3.js";

const TEST_TOKEN_PRESETS = [
  {
    label: "VESTA test token",
    mint: "4zFYPYxDAio8BDPqfpAWhEMzpyPANxJABmbWPmBq6LKx",
    description: "Devnet dummy SPL token for testing the vesting workflow."
  }
];

type FaucetToast = {
  type: "success" | "error";
  title: string;
  message: string;
  signature?: string;
};

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
  const [selectedPreset, setSelectedPreset] = useState("");
  const [rows, setRows] = useState("");
  const [start, setStart] = useState(defaultDate(5));
  const [end, setEnd] = useState(defaultDate(60 * 24 * 30));
  const [streams, setStreams] = useState<StreamView[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRequestingVesta, setIsRequestingVesta] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [faucetToast, setFaucetToast] = useState<FaucetToast | null>(null);

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
        endTime: Math.floor(new Date(end).getTime() / 1000)
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

  function selectPreset(value: string) {
    setSelectedPreset(value);
    if (value) {
      setMint(value);
    }
  }

  async function requestVesta() {
    setError("");
    setSuccess("");
    setFaucetToast(null);

    if (!wallet || !publicKey) {
      setFaucetToast({
        type: "error",
        title: "Request failed",
        message: "Connect an admin wallet first."
      });
      return;
    }

    let signature = "";
    try {
      setIsRequestingVesta(true);
      const transaction = await buildRequestVestaTransaction({
        connection,
        wallet: { publicKey },
        mint: new PublicKey(TEST_TOKEN_PRESETS[0].mint)
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
      signature = bs58.encode(result.signature);
      await connection.confirmTransaction(
        {
          signature,
          blockhash: prepared.blockhash,
          lastValidBlockHeight: prepared.lastValidBlockHeight
        },
        "confirmed"
      );
      setSelectedPreset(TEST_TOKEN_PRESETS[0].mint);
      setMint(TEST_TOKEN_PRESETS[0].mint);
      setSuccess(`Minted ${VESTA_FAUCET_AMOUNT} VESTA to your wallet.`);
      setFaucetToast({
        type: "success",
        title: "VESTA requested",
        message: `Minted ${VESTA_FAUCET_AMOUNT} VESTA to your wallet.`,
        signature
      });
    } catch (err) {
      const message = serializeTransactionError(err);
      setError(message);
      setFaucetToast({
        type: "error",
        title: "Request failed",
        message,
        signature: signature || undefined
      });
    } finally {
      setIsRequestingVesta(false);
    }
  }

  return (
    <>
      {faucetToast && (
        <div className={`toast ${faucetToast.type}`} role="status" aria-live="polite">
          <div>
            <strong>{faucetToast.title}</strong>
            <p>{faucetToast.message}</p>
            {faucetToast.signature && (
              <a href={explorerUrl(faucetToast.signature, "tx")} target="_blank" rel="noreferrer">
                Tx {faucetToast.signature.slice(0, 8)}...{faucetToast.signature.slice(-8)}
              </a>
            )}
          </div>
          <button type="button" onClick={() => setFaucetToast(null)} aria-label="Dismiss">
            Close
          </button>
        </div>
      )}

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
            <label htmlFor="token-preset">Token preset</label>
            <select
              id="token-preset"
              value={selectedPreset}
              onChange={(event) => selectPreset(event.target.value)}
            >
              <option value="">Custom SPL token</option>
              {TEST_TOKEN_PRESETS.map((preset) => (
                <option key={preset.mint} value={preset.mint}>
                  {preset.label}
                </option>
              ))}
            </select>
            {selectedPreset && (
              <p className="hint">
                {TEST_TOKEN_PRESETS.find((preset) => preset.mint === selectedPreset)?.description}
              </p>
            )}
          </div>

          {selectedPreset === TEST_TOKEN_PRESETS[0].mint && (
            <div className="faucet-card">
              <div>
                <strong>Need test tokens?</strong>
                <p className="hint">Mint {VESTA_FAUCET_AMOUNT} VESTA to your connected wallet.</p>
              </div>
              <button
                className="button secondary compact"
                type="button"
                onClick={requestVesta}
                disabled={isRequestingVesta}
              >
                <Coins size={15} aria-hidden="true" />
                {isRequestingVesta ? "Requesting..." : "Request VESTA"}
              </button>
            </div>
          )}

          <div className="field">
            <label htmlFor="mint">Token mint</label>
            <input
              id="mint"
              value={mint}
              onChange={(event) => setMint(event.target.value)}
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
            {adminStreams.map((stream) => (
              <StreamCard key={stream.publicKey.toBase58()} stream={stream} mode="admin" />
            ))}
          </div>
        )}
      </section>
      </main>
    </>
  );
}
