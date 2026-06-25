"use client";

import bs58 from "bs58";
import { Coins, Send, ArrowRight, ArrowLeft, CircleHelp, Info } from "lucide-react";
import { useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";

import {
  PRIVY_CONFIGURED,
  useActiveSolanaWallet,
  useSignAndSendTransaction
} from "@/components/privy-provider";
import {
  VESTA_FAUCET_AMOUNT,
  VESTA_MINT,
  buildCreateStreamTransaction,
  buildRequestVestaTransaction,
  explorerUrl,
  getConnection,
  parseCsvRows,
  prepareUnsignedTransaction,
  serializeTransactionError,
  type RecipientInputRow
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

type TxState = "idle" | "building" | "approving" | "sending" | "confirming" | "success" | "error";

type CreateStreamStep =
  | "select_token"
  | "recipient"
  | "schedule"
  | "review"
  | "signing"
  | "success";

function txStateLabel(state: TxState, action: string) {
  if (state === "building") return "Building transaction…";
  if (state === "approving") return `Approve in wallet…`;
  if (state === "sending") return "Sending…";
  if (state === "confirming") return "Confirming…";
  if (state === "success") return "Transaction Confirmed!";
  if (state === "error") return "Transaction Failed";
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
    throw new TypeError(`${label} date is invalid.`);
  }
  return Math.floor(time / 1000);
}

export default function CreateStreamPage() {
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

  return <CreateStreamPageInner />;
}

function CreateStreamPageInner() {
  const connection = useMemo(() => getConnection(), []);
  const { wallet, publicKey } = useActiveSolanaWallet();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  // Stream Wizard State
  const [step, setStep] = useState<CreateStreamStep>("select_token");

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

  // Tx state
  const [txState, setTxState] = useState<TxState>("idle");
  const [isRequestingVesta, setIsRequestingVesta] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [faucetToast, setFaucetToast] = useState<FaucetToast | null>(null);

  // New state for success link
  const [createdStreamIds, setCreatedStreamIds] = useState<string[]>([]);
  const [showTutorial, setShowTutorial] = useState(false);

  const parsedCsvRows = useMemo<RecipientInputRow[]>(() => {
    if (formTab === "single") return [];
    if (!rows.trim()) return [];
    return parseCsvRows(rows);
  }, [rows, formTab]);

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
    setTxState("success");
    return signature;
  }

  async function onSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!wallet || !publicKey) {
      setError("Connect an admin wallet first.");
      return;
    }
    setStep("signing");
    try {
      let finalRows: { wallet: string; amount: string }[] = [];

      if (formTab === "single") {
        finalRows = [{ wallet: recipient.trim(), amount: amount.trim() }];
      } else {
        const invalidRows = parsedCsvRows.filter(r => r.status === "invalid");
        if (invalidRows.length > 0) {
          throw new Error("Cannot create stream with invalid recipients. Please fix them.");
        }
        finalRows = parsedCsvRows.map(r => ({ wallet: r.wallet, amount: r.amount }));
      }

      const cliffTime = cliff ? parseLocalDateTime(cliff, "Cliff") : undefined;

      const { transaction, streams: newStreamAccounts } = await buildCreateStreamTransaction({
        connection,
        wallet: { publicKey },
        mint: new PublicKey(mint.trim()),
        rows: finalRows,
        startTime: parseLocalDateTime(start, "Start"),
        endTime: parseLocalDateTime(end, "End"),
        cliffTime
      });

      const signature = await runSignedTx(async () =>
        prepareUnsignedTransaction({ connection, transaction, feePayer: publicKey })
      );

      setSuccess(`Transaction confirmed: ${signature}`);
      setCreatedStreamIds(newStreamAccounts.map(s => s.vestingState.toBase58()));
      setStep("success");

      if (formTab === "single") {
        setRecipient("");
        setAmount("");
        setCliff("");
      } else {
        setRows("");
      }
    } catch (err) {
      setTxState("error");
      setError(serializeTransactionError(err));
      // Give them a chance to go back and fix
      setTimeout(() => setStep("review"), 3000);
    }
  }

  function selectPreset(value: string) {
    setSelectedPreset(value);
    if (value) setMint(value);
  }

  async function requestVesta() {
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

  const isSubmitting = txState !== "idle" && txState !== "success" && txState !== "error";

  const canProceedToRecipient = mint.trim() !== "";
  const canProceedToSchedule = formTab === "single"
    ? (recipient.trim() !== "" && amount.trim() !== "")
    : (parsedCsvRows.length > 0 && parsedCsvRows.every(r => r.status === "valid"));
  const canProceedToReview = start !== "" && end !== "";

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

      {showTutorial && (
        <dialog open className="modal-backdrop" aria-labelledby="tutorial-dialog-title">
          <div className="modal-box">
            <h2 id="tutorial-dialog-title">How to create a stream</h2>
            <div className="stack">
              <p>1. Ensure your wallet is connected to the Solana Devnet.</p>
              <p>2. Request VESTA test tokens if you need them.</p>
              <p>3. Go through the wizard to input recipient(s) and set up the vesting schedule.</p>
              <p>4. Review the details and sign the transaction in your wallet.</p>
              <p>5. Share the generated link with the recipient so they can claim their tokens.</p>
            </div>
            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button className="button primary compact" type="button" onClick={() => setShowTutorial(false)}>
                Got it
              </button>
            </div>
          </div>
        </dialog>
      )}

      <main className="page-shell single-column">
        <div style={{ marginBottom: 24 }}>
          <Link href="/admin" className="button secondary compact" style={{ display: 'inline-flex' }}>
            <ArrowLeft size={16} /> Back to Dashboard
          </Link>
        </div>

        <section className="panel form-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p className="eyebrow">Admin</p>
              <h1>Create vesting streams</h1>
              <p className="muted">
                Fund linear token streams from your connected wallet. Each recipient gets a PDA vault
                owned by the stream account.
              </p>
            </div>
            <button className="icon-button" type="button" onClick={() => setShowTutorial(true)} aria-label="View Guide" title="View Guide">
              <CircleHelp size={20} />
            </button>
          </div>

          <div style={{ marginTop: 16, marginBottom: 24, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)' }}>
            <Info size={14} />
            <span>Works with Phantom, Solflare, and other wallets supported by Privy.</span>
          </div>

          <form className="stack wizard-form" onSubmit={onSubmit} aria-busy={isSubmitting}>

            {/* WIZARD PROGRESS */}
            <div className="wizard-progress" style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {["select_token", "recipient", "schedule", "review", "signing", "success"].map((s, idx) => {
                const completedColor = ["select_token", "recipient", "schedule", "review", "signing", "success"].indexOf(step) > idx ? 'var(--foreground)' : 'var(--border)';
                return (
                  <div key={s} style={{
                    flex: 1,
                    height: 4,
                    background: step === s ? 'var(--foreground)' : completedColor,
                    borderRadius: 4
                  }} />
                );
              })}
            </div>

            {/* STEP 1: SELECT TOKEN */}
            {step === "select_token" && (
              <div className="wizard-step">
                <h3>1. Select Token</h3>
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
                <div className="action-row" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="button primary" disabled={!canProceedToRecipient} onClick={() => setStep("recipient")}>
                    Next <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: RECIPIENT */}
            {step === "recipient" && (
              <div className="wizard-step">
                <h3>2. Add Recipient(s)</h3>
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
                      />
                    </div>
                  </>
                ) : (
                  <div className="field">
                    <label htmlFor="recipients">Recipients and amounts (CSV/Paste)</label>
                    <textarea
                      id="recipients"
                      value={rows}
                      onChange={(event) => setRows(event.target.value)}
                      placeholder={"wallet_address,1000\nwallet_address,250.5"}
                      spellCheck={false}
                      rows={7}
                    />
                    <p className="hint">One recipient per line. Amounts use the mint decimals.</p>

                    {/* CSV Validation Table */}
                    {parsedCsvRows.length > 0 && (
                      <div className="validation-table" style={{ marginTop: 16, overflowX: 'auto' }}>
                        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                              <th style={{ padding: '8px 4px' }}>Row</th>
                              <th style={{ padding: '8px 4px' }}>Wallet</th>
                              <th style={{ padding: '8px 4px' }}>Amount</th>
                              <th style={{ padding: '8px 4px' }}>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {parsedCsvRows.map((row, i) => (
                              <tr key={`${row.wallet}-${i}`} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '8px 4px', color: 'var(--muted)' }}>{row.originalRow}</td>
                                <td style={{ padding: '8px 4px', fontFamily: 'monospace' }}>{row.wallet.slice(0, 8)}...{row.wallet.slice(-8)}</td>
                                <td style={{ padding: '8px 4px' }}>{row.amount}</td>
                                <td style={{ padding: '8px 4px' }}>
                                  {row.status === "valid" ? (
                                    <span style={{ color: '#10B981' }}>Valid</span>
                                  ) : (
                                    <span style={{ color: 'red' }}>Error: {row.error}</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                <div className="action-row" style={{ justifyContent: 'space-between' }}>
                  <button type="button" className="button secondary" onClick={() => setStep("select_token")}>
                    <ArrowLeft size={16} /> Back
                  </button>
                  <button type="button" className="button primary" disabled={!canProceedToSchedule} onClick={() => setStep("schedule")}>
                    Next <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: SCHEDULE */}
            {step === "schedule" && (
              <div className="wizard-step">
                <h3>3. Configure Schedule</h3>
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

                <div className="action-row" style={{ justifyContent: 'space-between' }}>
                  <button type="button" className="button secondary" onClick={() => setStep("recipient")}>
                    <ArrowLeft size={16} /> Back
                  </button>
                  <button type="button" className="button primary" disabled={!canProceedToReview} onClick={() => setStep("review")}>
                    Review <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4: REVIEW */}
            {step === "review" && (
              <div className="wizard-step">
                <h3>4. Review Stream</h3>
                <div className="panel" style={{ background: 'var(--surface)' }}>
                  <p><strong>Token Mint:</strong> {mint}</p>
                  <p><strong>Total Recipients:</strong> {formTab === "single" ? 1 : parsedCsvRows.filter(r => r.status === "valid").length}</p>
                  <p><strong>Start Time:</strong> {new Date(start).toLocaleString()}</p>
                  <p><strong>End Time:</strong> {new Date(end).toLocaleString()}</p>
                  {cliff && <p><strong>Cliff Time:</strong> {new Date(cliff).toLocaleString()}</p>}
                </div>

                {error && <p className="message error">{error}</p>}

                <div className="action-row" style={{ justifyContent: 'space-between' }}>
                  <button type="button" className="button secondary" onClick={() => setStep("schedule")}>
                    <ArrowLeft size={16} /> Back
                  </button>
                  <button className="button primary" type="submit">
                    <Send size={16} aria-hidden="true" />
                    Sign and Submit
                  </button>
                </div>
              </div>
            )}

            {/* STEP 5: SIGNING */}
            {step === "signing" && (
              <div className="wizard-step" style={{ textAlign: 'center', padding: '40px 0' }}>
                <div className="tx-state-bar" style={{ display: 'inline-flex', marginBottom: 24 }}>
                  <div className="tx-state-dot" />
                  {txStateLabel(txState, "Processing")}
                </div>
                <h3>Check your wallet</h3>
                <p className="muted">Please approve the transaction in your connected wallet provider to create the streams.</p>
                {error && <p className="message error">{error}</p>}
              </div>
            )}

            {/* STEP 6: SUCCESS */}
            {step === "success" && (
              <div className="wizard-step" style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'center', color: '#10B981', marginBottom: 16 }}>
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                </div>
                <h3>Streams Created Successfully!</h3>
                <p className="muted">{success}</p>

                <div className="stack" style={{ textAlign: 'left', marginTop: 24 }}>
                  {createdStreamIds.map((id, idx) => (
                    <div key={id} className="panel" style={{ padding: 16 }}>
                      <p className="eyebrow">Recipient {idx + 1} Link</p>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input type="text" readOnly value={`${globalThis.location.origin}/stream/${id}`} style={{ flex: 1 }} />
                        <button type="button" className="button secondary compact" onClick={() => {
                          navigator.clipboard.writeText(`${globalThis.location.origin}/stream/${id}`);
                          alert("Link copied!");
                        }}>
                          Copy Link
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="action-row justify-center" style={{ marginTop: 32 }}>
                  <button type="button" className="button secondary" onClick={() => {
                    setStep("select_token");
                    setFormTab("single");
                    setRecipient("");
                    setAmount("");
                    setRows("");
                    setSuccess("");
                    setCreatedStreamIds([]);
                  }}>
                    Create Another Stream
                  </button>
                  <Link href="/admin" className="button primary">
                    Go to Dashboard
                  </Link>
                </div>
              </div>
            )}
          </form>
        </section>
      </main>
    </>
  );
}
