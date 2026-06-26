"use client";

import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  Coins,
  Info,
  Plus,
  Search,
  Send,
  Trash2,
  X
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import {
  PRIVY_CONFIGURED,
  useActiveSolanaWallet,
  useSignAndSendTransaction
} from "@/components/privy-provider";
import { usePreferences } from "@/components/preferences-provider";
import { DEVNET_TOKENS, type DevnetToken } from "@/lib/devnet-tokens";
import { formatMessage } from "@/lib/i18n";
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
  shorten,
  type RecipientInputRow
} from "@/lib/vesting";

type FaucetToast = {
  type: "success" | "error";
  title: string;
  message: string;
  signature?: string;
};

type TxState = "idle" | "building" | "approving" | "sending" | "confirming" | "success" | "error";
type CreateStreamStep = "select_token" | "recipient" | "schedule" | "review" | "signing" | "success";
type ManualRecipientRow = { id: string; wallet: string; amount: string };

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

function createRecipientRow(): ManualRecipientRow {
  return {
    id: crypto.randomUUID(),
    wallet: "",
    amount: ""
  };
}

function isValidPublicKey(value: string) {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

export default function CreateStreamPage() {
  const { t } = usePreferences();

  if (!PRIVY_CONFIGURED) {
    return (
      <main className="page-shell single-column">
        <section className="panel">
          <p className="eyebrow">{t.create.eyebrow}</p>
          <h1>{t.common.privyRequiredTitle}</h1>
          <p className="muted">{t.create.privyRequired}</p>
        </section>
      </main>
    );
  }

  return <CreateStreamPageInner />;
}

function CreateStreamPageInner() {
  const { t } = usePreferences();
  const connection = useMemo(() => getConnection(), []);
  const { wallet, publicKey } = useActiveSolanaWallet();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const [step, setStep] = useState<CreateStreamStep>("select_token");
  const [formTab, setFormTab] = useState<"manual" | "csv">("manual");
  const [mint, setMint] = useState("");
  const [selectedToken, setSelectedToken] = useState<DevnetToken | null>(null);
  const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
  const [manualRows, setManualRows] = useState<ManualRecipientRow[]>([createRecipientRow()]);
  const [rows, setRows] = useState("");
  const [start, setStart] = useState(defaultDate(5));
  const [end, setEnd] = useState(defaultDate(60 * 24 * 30));
  const [cliff, setCliff] = useState("");
  const [txState, setTxState] = useState<TxState>("idle");
  const [isRequestingVesta, setIsRequestingVesta] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [faucetToast, setFaucetToast] = useState<FaucetToast | null>(null);
  const [createdStreamIds, setCreatedStreamIds] = useState<string[]>([]);
  const [showTutorial, setShowTutorial] = useState(false);

  const parsedCsvRows = useMemo<RecipientInputRow[]>(() => {
    if (formTab === "manual") return [];
    if (!rows.trim()) return [];
    return parseCsvRows(rows);
  }, [rows, formTab]);

  const manualValidation = useMemo(() => {
    const seen = new Set<string>();
    return manualRows.map((row) => {
      const walletValue = row.wallet.trim();
      const amountValue = row.amount.trim();
      let errorMessage = "";
      if (!walletValue || !amountValue) errorMessage = t.create.missingFields;
      else if (!isValidPublicKey(walletValue)) errorMessage = t.create.invalidWallet;
      else if (Number.isNaN(Number(amountValue.replaceAll(",", ""))) || Number(amountValue.replaceAll(",", "")) <= 0) {
        errorMessage = t.create.invalidAmount;
      } else if (seen.has(walletValue)) {
        errorMessage = t.create.duplicateWallet;
      }
      seen.add(walletValue);
      return { ...row, status: errorMessage ? "invalid" as const : "valid" as const, error: errorMessage };
    });
  }, [manualRows, t.create.duplicateWallet, t.create.invalidAmount, t.create.invalidWallet, t.create.missingFields]);

  function txStateLabel(state: TxState, action: string) {
    if (state === "building") return t.create.building;
    if (state === "approving") return t.create.approving;
    if (state === "sending") return t.create.sending;
    if (state === "confirming") return t.create.confirming;
    if (state === "success") return t.create.txSuccess;
    if (state === "error") return t.create.txFailed;
    return action;
  }

  async function runSignedTx(
    buildFn: () => Promise<{ bytes: Uint8Array; blockhash: string; lastValidBlockHeight: number }>
  ) {
    if (!wallet || !publicKey) throw new Error(t.create.connectWallet);
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
      setError(t.create.connectAdmin);
      return;
    }
    setStep("signing");
    try {
      let finalRows: { wallet: string; amount: string }[] = [];

      if (formTab === "manual") {
        const validRows = manualValidation.filter((row) => row.status === "valid");
        if (validRows.length !== manualRows.length || validRows.length === 0) {
          throw new Error(t.create.manualRequired);
        }
        finalRows = validRows.map((row) => ({ wallet: row.wallet.trim(), amount: row.amount.trim() }));
      } else {
        const invalidRows = parsedCsvRows.filter((row) => row.status === "invalid");
        if (invalidRows.length > 0) throw new Error(t.create.invalidRecipients);
        finalRows = parsedCsvRows.map((row) => ({ wallet: row.wallet, amount: row.amount }));
      }

      const cliffTime = cliff ? parseLocalDateTime(cliff, t.create.cliff) : undefined;
      const { transaction, streams: newStreamAccounts } = await buildCreateStreamTransaction({
        connection,
        wallet: { publicKey },
        mint: new PublicKey(mint.trim()),
        rows: finalRows,
        startTime: parseLocalDateTime(start, t.create.start),
        endTime: parseLocalDateTime(end, t.create.end),
        cliffTime
      });

      const signature = await runSignedTx(async () =>
        prepareUnsignedTransaction({ connection, transaction, feePayer: publicKey })
      );

      setSuccess(formatMessage(t.create.txConfirmed, { signature }));
      setCreatedStreamIds(newStreamAccounts.map((stream) => stream.vestingState.toBase58()));
      setStep("success");
      if (formTab === "manual") setManualRows([createRecipientRow()]);
      else setRows("");
      setCliff("");
    } catch (err) {
      setTxState("error");
      setError(serializeTransactionError(err));
      setTimeout(() => setStep("review"), 3000);
    }
  }

  function selectToken(token: DevnetToken | null, customMint?: string) {
    setSelectedToken(token);
    setMint(token?.mint ?? customMint ?? "");
    setTokenPickerOpen(false);
  }

  async function requestVesta() {
    setFaucetToast(null);
    if (!wallet || !publicKey) {
      setFaucetToast({ type: "error", title: t.create.requestFailed, message: t.create.connectWallet });
      return;
    }
    let signature = "";
    try {
      setIsRequestingVesta(true);
      const transaction = await buildRequestVestaTransaction({ connection, wallet: { publicKey } });
      const prepared = await prepareUnsignedTransaction({ connection, transaction, feePayer: publicKey });
      const result = await signAndSendTransaction({ transaction: prepared.bytes, wallet, chain: "solana:devnet" });
      signature = bs58.encode(result.signature);
      await connection.confirmTransaction(
        { signature, blockhash: prepared.blockhash, lastValidBlockHeight: prepared.lastValidBlockHeight },
        "confirmed"
      );
      selectToken(DEVNET_TOKENS[0]);
      setFaucetToast({
        type: "success",
        title: t.create.faucetSuccessTitle,
        message: formatMessage(t.create.faucetSuccess, { amount: VESTA_FAUCET_AMOUNT }),
        signature
      });
    } catch (err) {
      setFaucetToast({
        type: "error",
        title: t.create.requestFailed,
        message: serializeTransactionError(err),
        signature: signature || undefined
      });
    } finally {
      setIsRequestingVesta(false);
    }
  }

  function updateManualRow(id: string, field: "wallet" | "amount", value: string) {
    setManualRows((current) => current.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }

  function removeManualRow(id: string) {
    setManualRows((current) => (current.length === 1 ? current : current.filter((row) => row.id !== id)));
  }

  const isSubmitting = txState !== "idle" && txState !== "success" && txState !== "error";
  const selectedIsVesta = mint === VESTA_MINT.toBase58();
  const canProceedToRecipient = mint.trim() !== "";
  const canProceedToSchedule =
    formTab === "manual"
      ? manualValidation.length > 0 && manualValidation.every((row) => row.status === "valid")
      : parsedCsvRows.length > 0 && parsedCsvRows.every((row) => row.status === "valid");
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
                Tx {shorten(faucetToast.signature, 8)}
              </a>
            )}
          </div>
          <button type="button" onClick={() => setFaucetToast(null)} aria-label={t.common.close}>
            {t.common.close}
          </button>
        </div>
      )}

      {showTutorial && (
        <dialog open className="modal-backdrop" aria-labelledby="tutorial-dialog-title">
          <div className="modal-box">
            <h2 id="tutorial-dialog-title">{t.create.tutorialTitle}</h2>
            <div className="stack">
              {t.create.tutorial.map((item, index) => (
                <p key={item}>{index + 1}. {item}</p>
              ))}
            </div>
            <div className="modal-actions">
              <button className="button primary compact" type="button" onClick={() => setShowTutorial(false)}>
                {t.create.gotIt}
              </button>
            </div>
          </div>
        </dialog>
      )}

      {tokenPickerOpen && (
        <TokenPicker
          mint={mint}
          onClose={() => setTokenPickerOpen(false)}
          onSelect={selectToken}
        />
      )}

      <main className="page-shell single-column">
        <div className="page-back-row">
          <Link href="/admin" className="button secondary compact">
            <ArrowLeft size={16} aria-hidden="true" /> {t.create.backDashboard}
          </Link>
        </div>

        <section className="panel form-panel">
          <div className="form-header-row">
            <div>
              <p className="eyebrow">{t.create.eyebrow}</p>
              <h1>{t.create.title}</h1>
              <p className="muted">{t.create.subtitle}</p>
            </div>
            <button className="icon-button" type="button" onClick={() => setShowTutorial(true)} aria-label={t.create.guide} title={t.create.guide}>
              <CircleHelp size={20} aria-hidden="true" />
            </button>
          </div>

          <div className="inline-note">
            <Info size={14} aria-hidden="true" />
            <span>{t.create.walletNote}</span>
          </div>

          <form className="stack wizard-form" onSubmit={onSubmit} aria-busy={isSubmitting}>
            <div className="wizard-progress" aria-label="Progress">
              {t.create.steps.map((label, index) => {
                const keys: CreateStreamStep[] = ["select_token", "recipient", "schedule", "review", "signing", "success"];
                const activeIndex = keys.indexOf(step);
                return (
                  <span
                    key={label}
                    className={index <= activeIndex ? "active" : ""}
                    title={label}
                  />
                );
              })}
            </div>

            {step === "select_token" && (
              <div className="wizard-step">
                <h3>{t.create.selectToken}</h3>
                <button className="token-select-button" type="button" onClick={() => setTokenPickerOpen(true)}>
                  <span className="token-avatar">{selectedToken?.symbol.slice(0, 2) ?? t.common.token.slice(0, 2)}</span>
                  <span>
                    <strong>{selectedToken?.symbol ?? t.create.chooseToken}</strong>
                    <small>{selectedToken?.name ?? t.create.chooseTokenHint}</small>
                  </span>
                  <ArrowRight size={16} aria-hidden="true" />
                </button>

                {selectedIsVesta && (
                  <div className="faucet-card">
                    <div>
                      <strong>{t.create.needTokens}</strong>
                      <p className="hint">{formatMessage(t.create.faucetHint, { amount: VESTA_FAUCET_AMOUNT })}</p>
                    </div>
                    <button className="button secondary compact" type="button" onClick={requestVesta} disabled={isRequestingVesta}>
                      <Coins size={15} aria-hidden="true" />
                      {isRequestingVesta ? t.create.requesting : t.create.requestVesta}
                    </button>
                  </div>
                )}

                <div className="field">
                  <label htmlFor="mint">{t.create.tokenMint}</label>
                  <input
                    id="mint"
                    value={mint}
                    onChange={(event) => {
                      setMint(event.target.value);
                      setSelectedToken(DEVNET_TOKENS.find((token) => token.mint === event.target.value) ?? null);
                    }}
                    placeholder={t.create.tokenMintPlaceholder}
                    spellCheck={false}
                    required
                  />
                </div>
                <div className="action-row align-end">
                  <button type="button" className="button primary" disabled={!canProceedToRecipient} onClick={() => setStep("recipient")}>
                    {t.common.next} <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}

            {step === "recipient" && (
              <div className="wizard-step">
                <h3>{t.create.addRecipients}</h3>
                <div className="tab-bar" role="tablist" aria-label="Entry mode">
                  <button role="tab" type="button" aria-selected={formTab === "manual"} className={`tab ${formTab === "manual" ? "active" : ""}`} onClick={() => setFormTab("manual")}>
                    {t.create.manualInput}
                  </button>
                  <button role="tab" type="button" aria-selected={formTab === "csv"} className={`tab ${formTab === "csv" ? "active" : ""}`} onClick={() => setFormTab("csv")}>
                    {t.create.batchCsv}
                  </button>
                </div>

                {formTab === "manual" ? (
                  <div className="manual-recipient-list">
                    {manualValidation.map((row, index) => (
                      <div className="recipient-row" key={row.id}>
                        <div className="field">
                          <label htmlFor={`recipient-${row.id}`}>{t.create.recipientWallet}</label>
                          <input
                            id={`recipient-${row.id}`}
                            value={row.wallet}
                            onChange={(event) => updateManualRow(row.id, "wallet", event.target.value)}
                            placeholder="Solana wallet address"
                            spellCheck={false}
                            aria-invalid={row.wallet && row.status === "invalid" ? "true" : undefined}
                          />
                        </div>
                        <div className="field amount-field">
                          <label htmlFor={`amount-${row.id}`}>{t.create.amountLabel}</label>
                          <input
                            id={`amount-${row.id}`}
                            type="text"
                            inputMode="decimal"
                            value={row.amount}
                            onChange={(event) => updateManualRow(row.id, "amount", event.target.value)}
                            placeholder="1000"
                            aria-invalid={row.amount && row.status === "invalid" ? "true" : undefined}
                          />
                        </div>
                        <button
                          className="icon-button remove-row-button"
                          type="button"
                          onClick={() => removeManualRow(row.id)}
                          aria-label={t.create.removeRecipient}
                          disabled={manualRows.length === 1}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                        {row.status === "invalid" && (row.wallet || row.amount) && (
                          <p className="field-error">
                            {index + 1}. {row.error}
                          </p>
                        )}
                      </div>
                    ))}
                    <button className="button secondary compact" type="button" onClick={() => setManualRows((current) => [...current, createRecipientRow()])}>
                      <Plus size={16} aria-hidden="true" /> {t.create.addRecipient}
                    </button>
                  </div>
                ) : (
                  <div className="field">
                    <label htmlFor="recipients">{t.create.csvLabel}</label>
                    <textarea
                      id="recipients"
                      value={rows}
                      onChange={(event) => setRows(event.target.value)}
                      placeholder={t.create.csvPlaceholder}
                      spellCheck={false}
                      rows={7}
                    />
                    <p className="hint">{t.create.csvHint}</p>

                    {parsedCsvRows.length > 0 && (
                      <div className="validation-table">
                        <table>
                          <thead>
                            <tr>
                              <th>{t.common.row}</th>
                              <th>{t.common.wallet}</th>
                              <th>{t.common.amount}</th>
                              <th>{t.common.status}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {parsedCsvRows.map((row, index) => (
                              <tr key={`${row.wallet}-${index}`}>
                                <td>{row.originalRow}</td>
                                <td className="mono-cell">{row.wallet ? shorten(row.wallet, 8) : "-"}</td>
                                <td>{row.amount}</td>
                                <td>
                                  {row.status === "valid" ? (
                                    <span className="success-text">{t.common.valid}</span>
                                  ) : (
                                    <span className="danger-text">{t.common.error}: {row.error}</span>
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

                <div className="action-row spread">
                  <button type="button" className="button secondary" onClick={() => setStep("select_token")}>
                    <ArrowLeft size={16} aria-hidden="true" /> {t.common.back}
                  </button>
                  <button type="button" className="button primary" disabled={!canProceedToSchedule} onClick={() => setStep("schedule")}>
                    {t.common.next} <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}

            {step === "schedule" && (
              <div className="wizard-step">
                <h3>{t.create.configureSchedule}</h3>
                <div className="field-grid">
                  <div className="field">
                    <label htmlFor="start">{t.create.start}</label>
                    <input id="start" type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} required />
                  </div>
                  <div className="field">
                    <label htmlFor="end">{t.create.end}</label>
                    <input id="end" type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} required />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="cliff">{t.create.cliff} <span className="hint-inline">({t.create.optional})</span></label>
                  <input id="cliff" type="datetime-local" value={cliff} onChange={(event) => setCliff(event.target.value)} min={start} max={end} />
                  <p className="hint">{t.create.cliffHint}</p>
                </div>
                <div className="action-row spread">
                  <button type="button" className="button secondary" onClick={() => setStep("recipient")}>
                    <ArrowLeft size={16} aria-hidden="true" /> {t.common.back}
                  </button>
                  <button type="button" className="button primary" disabled={!canProceedToReview} onClick={() => setStep("review")}>
                    {t.common.review} <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}

            {step === "review" && (
              <div className="wizard-step">
                <h3>{t.create.reviewTitle}</h3>
                <div className="review-box">
                  <p><strong>{t.create.tokenMint}:</strong> {mint}</p>
                  <p><strong>{t.create.totalRecipients}:</strong> {formTab === "manual" ? manualValidation.filter((row) => row.status === "valid").length : parsedCsvRows.filter((row) => row.status === "valid").length}</p>
                  <p><strong>{t.create.startTime}:</strong> {new Date(start).toLocaleString()}</p>
                  <p><strong>{t.create.endTime}:</strong> {new Date(end).toLocaleString()}</p>
                  {cliff && <p><strong>{t.create.cliffTime}:</strong> {new Date(cliff).toLocaleString()}</p>}
                </div>
                {error && <p className="message error">{error}</p>}
                <div className="action-row spread">
                  <button type="button" className="button secondary" onClick={() => setStep("schedule")}>
                    <ArrowLeft size={16} aria-hidden="true" /> {t.common.back}
                  </button>
                  <button className="button primary" type="submit">
                    <Send size={16} aria-hidden="true" /> {t.create.signSubmit}
                  </button>
                </div>
              </div>
            )}

            {step === "signing" && (
              <div className="wizard-step centered-step">
                <div className="tx-state-bar">
                  <div className="tx-state-dot" />
                  {txStateLabel(txState, t.create.processing)}
                </div>
                <h3>{t.create.checkWallet}</h3>
                <p className="muted">{t.create.approveWallet}</p>
                {error && <p className="message error">{error}</p>}
              </div>
            )}

            {step === "success" && (
              <div className="wizard-step centered-step">
                <div className="success-orb">
                  <Check size={36} aria-hidden="true" />
                </div>
                <h3>{t.create.successTitle}</h3>
                <p className="muted">{success}</p>
                <div className="stack link-stack">
                  {createdStreamIds.map((id, index) => (
                    <div key={id} className="panel compact-link-panel">
                      <p className="eyebrow">{formatMessage(t.create.linkLabel, { index: index + 1 })}</p>
                      <div className="copy-row">
                        <input type="text" readOnly value={`${globalThis.location.origin}/stream/${id}`} />
                        <button
                          type="button"
                          className="button secondary compact"
                          onClick={() => {
                            void navigator.clipboard.writeText(`${globalThis.location.origin}/stream/${id}`);
                            window.alert(t.common.copied);
                          }}
                        >
                          {t.common.copy}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" className="button primary" onClick={() => { setStep("select_token"); setTxState("idle"); }}>
                  {t.create.createAnother}
                </button>
              </div>
            )}
          </form>
        </section>
      </main>
    </>
  );
}

function TokenPicker({
  mint,
  onClose,
  onSelect
}: Readonly<{
  mint: string;
  onClose: () => void;
  onSelect: (token: DevnetToken | null, customMint?: string) => void;
}>) {
  const { t } = usePreferences();
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const filteredTokens = DEVNET_TOKENS.filter((token) =>
    [token.symbol, token.name, token.mint].some((value) => value.toLowerCase().includes(normalized))
  );
  const canUseCustom = query.trim() !== "" && isValidPublicKey(query.trim());

  return (
    <dialog open className="modal-backdrop token-picker-backdrop" aria-labelledby="token-picker-title">
      <div className="modal-box token-picker">
        <div className="token-picker-header">
          <div>
            <h2 id="token-picker-title">{t.create.chooseToken}</h2>
            <p>{t.create.chooseTokenHint}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t.common.close}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <label className="token-search">
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.create.searchToken} spellCheck={false} autoFocus />
        </label>
        <div className="token-list">
          {filteredTokens.map((token) => {
            const selected = token.mint === mint;
            return (
              <button className={`token-row ${selected ? "selected" : ""}`} type="button" key={token.mint} onClick={() => onSelect(token)}>
                <span className="token-avatar">{token.symbol.slice(0, 2)}</span>
                <span>
                  <strong>{token.symbol}</strong>
                  <small>{token.name} · {shorten(token.mint, 6)}</small>
                </span>
                <span className="network-pill">Devnet</span>
              </button>
            );
          })}
          {canUseCustom && (
            <button className="token-row" type="button" onClick={() => onSelect(null, query.trim())}>
              <span className="token-avatar">{t.common.custom.slice(0, 2)}</span>
              <span>
                <strong>{t.create.customMint}</strong>
                <small>{shorten(query.trim(), 6)}</small>
              </span>
              <span className="network-pill">Devnet</span>
            </button>
          )}
          {filteredTokens.length === 0 && !canUseCustom && <p className="empty-token-copy">{t.create.noToken}</p>}
        </div>
      </div>
    </dialog>
  );
}
