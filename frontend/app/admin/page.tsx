"use client";

import bs58 from "bs58";
import { Coins, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";

import { StreamCard } from "@/components/stream-card";
import {
  PRIVY_CONFIGURED,
  useActiveSolanaWallet,
  useSignAndSendTransaction
} from "@/components/privy-provider";
import {
  VESTA_FAUCET_AMOUNT,
  VESTA_MINT,
  buildCancelStreamTransaction,
  buildCreateStreamTransaction,
  buildRequestVestaTransaction,
  explorerUrl,
  fetchStreams,
  getConnection,
  parseCsvRows,
  prepareUnsignedTransaction,
  serializeTransactionError,
  type StreamView
} from "@/lib/vesting";

const TEST_TOKEN_PRESETS = [
  {
    label: "VESTA test token",
    mint: VESTA_MINT.toBase58(),
    description: "Devnet dummy SPL token for testing the vesting workflow."
  }
];

type FaucetToast = {
  type: "success" | "error";
  title: string;
  message: string;
  signature?: string;
};

type VestingEstimate = {
  total: string;
  duration: string;
  perDay: string;
  perHour: string;
  perSecond: string;
  symbol: string;
};

type TxState = "idle" | "building" | "approving" | "sending" | "confirming";

function txStateLabel(state: TxState, action: string) {
  if (state === "building") return "Building transaction…";
  if (state === "approving") return `Approve in wallet…`;
  if (state === "sending") return "Sending…";
  if (state === "confirming") return "Confirming…";
  return action;
}

function defaultDate(minutesFromNow: number) {
  const date = new Date(Date.now() + minutesFromNow * 60 * 1000);
  date.setSeconds(0, 0);
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return offsetDate.toISOString().slice(0, 16);
}

function parseLocalDateTime(value: string, label: string) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) {
    throw new Error(`${label} date is invalid.`);
  }
  return Math.floor(time / 1000);
}

function formatNumber(value: number, maximumFractionDigits = 6) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits,
    minimumFractionDigits: 0
  }).format(value);
}

function formatDuration(seconds: number) {
  const days = seconds / 86_400;
  if (days >= 1) return `${formatNumber(days, 2)} day${days === 1 ? "" : "s"}`;
  const hours = seconds / 3_600;
  if (hours >= 1) return `${formatNumber(hours, 2)} hour${hours === 1 ? "" : "s"}`;
  const minutes = seconds / 60;
  if (minutes >= 1) return `${formatNumber(minutes, 2)} minute${minutes === 1 ? "" : "s"}`;
  return `${formatNumber(seconds, 2)} second${seconds === 1 ? "" : "s"}`;
}

function getVestingEstimate(
  rows: string,
  start: string,
  end: string,
  symbol: string,
  mode: "single" | "csv",
  singleRecipient: string,
  singleAmount: string
) {
  try {
    let total = 0;
    if (mode === "csv") {
      const parsedRows = parseCsvRows(rows);
      total = parsedRows.reduce((sum, row) => {
        const amount = Number(row.amount.replace(/,/g, ""));
        if (!Number.isFinite(amount)) throw new Error("Invalid amount.");
        return sum + amount;
      }, 0);
    } else {
      total = Number(singleAmount.replace(/,/g, ""));
      if (!Number.isFinite(total) || total <= 0) return null;
    }
    const startTime = parseLocalDateTime(start, "Start");
    const endTime = parseLocalDateTime(end, "End");
    const durationSeconds = endTime - startTime;
    if (total <= 0 || durationSeconds <= 0) return null;
    return {
      total: formatNumber(total, 6),
      duration: formatDuration(durationSeconds),
      perDay: formatNumber(total / (durationSeconds / 86_400), 6),
      perHour: formatNumber(total / (durationSeconds / 3_600), 6),
      perSecond: formatNumber(total / durationSeconds, 8),
      symbol
    } satisfies VestingEstimate;
  } catch {
    return null;
  }
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

  // Form state
  const [formTab, setFormTab] = useState<"single" | "csv">("single");
  const [mint, setMint] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("");
  // Single-recipient fields
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [cliff, setCliff] = useState("");
  // CSV fields
  const [rows, setRows] = useState("");
  const [start, setStart] = useState(defaultDate(5));
  const [end, setEnd] = useState(defaultDate(60 * 24 * 30));

  // Stream state
  const [streams, setStreams] = useState<StreamView[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [txState, setTxState] = useState<TxState>("idle");
  const [isRequestingVesta, setIsRequestingVesta] = useState(false);
  const [cancellingId, setCancellingId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [faucetToast, setFaucetToast] = useState<FaucetToast | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState<StreamView | null>(null);

  const adminStreams = useMemo(() => {
    if (!publicKey) return [];
    return streams.filter((stream) => stream.account.funder.equals(publicKey));
  }, [streams, publicKey]);

  const symbol = selectedPreset === TEST_TOKEN_PRESETS[0].mint ? "VESTA" : "tokens";
  const estimate = useMemo(
    () => getVestingEstimate(rows, start, end, symbol, formTab, recipient, amount),
    [rows, start, end, symbol, formTab, recipient, amount]
  );

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

  async function runSignedTx(
    buildFn: () => Promise<{ bytes: Uint8Array; blockhash: string; lastValidBlockHeight: number }>
  ) {
    if (!wallet || !publicKey) throw new Error("Connect a wallet first.");
    setTxState("building");
    const prepared = await buildFn();
    setTxState("approving");
    const result = await signAndSendTransaction({
      transaction: prepared.bytes,
      wallet,
      chain: "solana:devnet"
    });
    const signature = bs58.encode(result.signature);
    setTxState("confirming");
    await connection.confirmTransaction(
      {
        signature,
        blockhash: prepared.blockhash,
        lastValidBlockHeight: prepared.lastValidBlockHeight
      },
      "confirmed"
    );
    setTxState("idle");
    return signature;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!wallet || !publicKey) {
      setError("Connect an admin wallet first.");
      return;
    }
    try {
      const parsedRows =
        formTab === "single"
          ? [{ wallet: recipient.trim(), amount: amount.trim() }]
          : parseCsvRows(rows);

      const cliffTime = cliff ? parseLocalDateTime(cliff, "Cliff") : undefined;

      const { transaction } = await buildCreateStreamTransaction({
        connection,
        wallet: { publicKey },
        mint: new PublicKey(mint.trim()),
        rows: parsedRows,
        startTime: parseLocalDateTime(start, "Start"),
        endTime: parseLocalDateTime(end, "End"),
        cliffTime
      });

      await runSignedTx(async () =>
        prepareUnsignedTransaction({ connection, transaction, feePayer: publicKey })
      );
      setSuccess(`Created ${parsedRows.length} stream${parsedRows.length === 1 ? "" : "s"}.`);
      if (formTab === "single") {
        setRecipient("");
        setAmount("");
        setCliff("");
      } else {
        setRows("");
      }
      await loadStreams();
    } catch (err) {
      setTxState("idle");
      setError(serializeTransactionError(err));
    }
  }

  function selectPreset(value: string) {
    setSelectedPreset(value);
    if (value) setMint(value);
  }

  async function requestVesta() {
    setError("");
    setSuccess("");
    setFaucetToast(null);
    if (!wallet || !publicKey) {
      setFaucetToast({ type: "error", title: "Request failed", message: "Connect a wallet first." });
      return;
    }
    let signature = "";
    try {
      setIsRequestingVesta(true);
      const transaction = await buildRequestVestaTransaction({ connection, wallet: { publicKey } });
      const prepared = await prepareUnsignedTransaction({ connection, transaction, feePayer: publicKey });
      const result = await signAndSendTransaction({ transaction: prepared.bytes, wallet, chain: "solana:devnet" });
      signature = bs58.encode(result.signature);
      await connection.confirmTransaction({ signature, blockhash: prepared.blockhash, lastValidBlockHeight: prepared.lastValidBlockHeight }, "confirmed");
      setSelectedPreset(VESTA_MINT.toBase58());
      setMint(VESTA_MINT.toBase58());
      setFaucetToast({ type: "success", title: "VESTA requested", message: `Minted ${VESTA_FAUCET_AMOUNT} VESTA to your wallet.`, signature });
    } catch (err) {
      const message = serializeTransactionError(err);
      setFaucetToast({ type: "error", title: "Request failed", message, signature: signature || undefined });
    } finally {
      setIsRequestingVesta(false);
    }
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
      setSuccess(`Stream cancelled. Tx: ${signature.slice(0, 8)}…`);
      await loadStreams();
    } catch (err) {
      setTxState("idle");
      setError(serializeTransactionError(err));
    } finally {
      setCancellingId("");
    }
  }

  const isSubmitting = txState !== "idle" && cancellingId === "";

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

      {cancelConfirm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="cancel-dialog-title">
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
            {/* Token selection */}
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

            {selectedPreset === VESTA_MINT.toBase58() && (
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

            {/* Single / CSV tab toggle */}
            <div className="tab-bar" role="tablist" aria-label="Entry mode">
              <button
                role="tab"
                type="button"
                aria-selected={formTab === "single"}
                className={`tab ${formTab === "single" ? "active" : ""}`}
                onClick={() => setFormTab("single")}
              >
                Single recipient
              </button>
              <button
                role="tab"
                type="button"
                aria-selected={formTab === "csv"}
                className={`tab ${formTab === "csv" ? "active" : ""}`}
                onClick={() => setFormTab("csv")}
              >
                Batch CSV
              </button>
            </div>

            {formTab === "single" ? (
              <>
                <div className="field">
                  <label htmlFor="recipient-address">Recipient wallet address</label>
                  <input
                    id="recipient-address"
                    value={recipient}
                    onChange={(event) => setRecipient(event.target.value)}
                    placeholder="Solana wallet address"
                    spellCheck={false}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="token-amount">Amount</label>
                  <input
                    id="token-amount"
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="e.g. 1000"
                    required
                  />
                </div>
              </>
            ) : (
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
            )}

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
              <label htmlFor="cliff">
                Cliff date <span className="hint-inline">(optional)</span>
              </label>
              <input
                id="cliff"
                type="datetime-local"
                value={cliff}
                onChange={(event) => setCliff(event.target.value)}
                min={start}
                max={end}
              />
              <p className="hint">No tokens unlock before this date. Defaults to the start date.</p>
            </div>

            {txState !== "idle" && (
              <p className="message" aria-live="polite">
                {txStateLabel(txState, "")}
              </p>
            )}
            {error && <p className="message error">{error}</p>}
            {success && <p className="message success">{success}</p>}

            <button className="button primary full" type="submit" disabled={isSubmitting}>
              <Send size={16} aria-hidden="true" />
              {isSubmitting ? txStateLabel(txState, "Create stream") : "Create stream"}
            </button>
          </form>
        </section>

        <EstimateCard estimate={estimate} />

        <section className="panel dashboard-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Dashboard</p>
              <h2>Streams you created</h2>
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
              <strong>No streams yet</strong>
              <p>Create a stream from this wallet to track recipients here.</p>
            </div>
          ) : (
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
          )}
        </section>
      </main>
    </>
  );
}

function EstimateCard({ estimate }: { estimate: VestingEstimate | null }) {
  return (
    <section className="panel estimate-panel">
      <p className="eyebrow">Live estimation</p>
      <h2>Unlock rate</h2>
      {estimate ? (
        <div className="estimate-list">
          <div>
            <span>Total</span>
            <strong>
              {estimate.total} {estimate.symbol}
            </strong>
          </div>
          <div>
            <span>Duration</span>
            <strong>{estimate.duration}</strong>
          </div>
          <div>
            <span>Per day</span>
            <strong>
              {estimate.perDay} {estimate.symbol}
            </strong>
          </div>
          <div>
            <span>Per hour</span>
            <strong>
              {estimate.perHour} {estimate.symbol}
            </strong>
          </div>
          <div>
            <span>Per second</span>
            <strong>
              {estimate.perSecond} {estimate.symbol}
            </strong>
          </div>
        </div>
      ) : (
        <div className="empty-state compact-empty">
          <strong>No estimate yet</strong>
          <p>Add valid recipients, amounts, start time, and end time.</p>
        </div>
      )}
    </section>
  );
}
