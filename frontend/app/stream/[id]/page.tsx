"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import bs58 from "bs58";
import { Wallet } from "lucide-react";
import Link from "next/link";

import { usePrivy } from "@privy-io/react-auth";

import { usePreferences } from "@/components/preferences-provider";
import { StreamCard } from "@/components/stream-card";
import {
  PRIVY_CONFIGURED,
  useActiveSolanaWallet,
  useSignAndSendTransaction
} from "@/components/privy-provider";
import {
  buildWithdrawTransaction,
  fetchStream,
  getConnection,
  prepareUnsignedTransaction,
  rawToDecimal,
  serializeTransactionError,
  type StreamView
} from "@/lib/vesting";

export default function StreamDetailPage() {
  const { t } = usePreferences();
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  if (!PRIVY_CONFIGURED) {
    return (
      <main className="page-shell single-column">
        <section className="panel">
          <p className="eyebrow">{t.stream.detailEyebrow}</p>
          <h1>{t.common.privyRequiredTitle}</h1>
          <p className="muted">{t.stream.privyRequired}</p>
        </section>
      </main>
    );
  }

  if (!id) {
    return (
      <main className="page-shell single-column">
        <section className="panel">
          <h1>{t.stream.invalidTitle}</h1>
          <p className="muted">{t.stream.invalidText}</p>
        </section>
      </main>
    );
  }

  return <StreamDetailPageInner id={id} />;
}

function StreamDetailPageInner({ id }: Readonly<{ id: string }>) {
  const { t } = usePreferences();
  const connection = useMemo(() => getConnection(), []);
  const { wallet, publicKey } = useActiveSolanaWallet();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { login, authenticated } = usePrivy();

  const [stream, setStream] = useState<StreamView | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const data = await fetchStream(connection, id);
        if (active) {
          if (!data) throw new Error(t.stream.notFoundError);
          setStream(data);
        }
      } catch (err) {
        if (active) setError(serializeTransactionError(err));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [connection, id, t.stream.notFoundError]);

  async function claim() {
    if (!stream) return;
    if (!wallet || !publicKey) {
      setError(t.recipient.connectFirst);
      return;
    }

    setError("");
    setSuccess("");
    setClaiming(true);
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
      setSuccess(t.recipient.claimed.replace("{amount}", rawToDecimal(stream.claimableRaw, stream.decimals)));

      // Reload stream data after claim
      const updatedStream = await fetchStream(connection, id);
      if (updatedStream) setStream(updatedStream);
    } catch (err) {
      setError(serializeTransactionError(err));
    } finally {
      setClaiming(false);
    }
  }

  const isRecipient = publicKey && stream?.account.recipient.equals(publicKey);
  const hasClaimable = stream ? stream.claimableRaw > 0n : false;

  let streamContent;
  if (loading) {
    streamContent = (
      <div className="skeleton-list" aria-label={t.common.loading}>
        <span />
      </div>
    );
  } else if (stream) {
    streamContent = (
      <div className="stream-list">
        <StreamCard
          stream={stream}
          mode="recipient"
          action={
            <StreamAction
              authenticated={authenticated}
              isRecipient={!!isRecipient}
              login={login}
              claim={claim}
              hasClaimable={hasClaimable}
              claiming={claiming}
              hasVault={!!stream.vault}
            />
          }
        />
      </div>
    );
  } else {
    streamContent = (
      <div className="empty-state">
        <strong>{t.stream.notFoundTitle}</strong>
        <p>{t.stream.notFoundText}</p>
      </div>
    );
  }

  return (
    <main className="page-shell single-column">
      <section className="panel dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{t.stream.eyebrow}</p>
            <h1>{t.stream.title}</h1>
            <p className="muted">{t.stream.subtitle}</p>
          </div>
        </div>

        {error && <p className="message error">{error}</p>}
        {success && <p className="message success">{success}</p>}

        {streamContent}

        {stream && authenticated && isRecipient && (
          <div style={{ marginTop: 24, textAlign: 'center' }}>
            <Link href="/recipient" className="button secondary">
              {t.stream.viewAll}
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}

function StreamAction({
  authenticated,
  isRecipient,
  login,
  claim,
  hasClaimable,
  claiming,
  hasVault
}: Readonly<{
  authenticated: boolean;
  isRecipient: boolean;
  login: () => void;
  claim: () => void;
  hasClaimable: boolean;
  claiming: boolean;
  hasVault: boolean;
}>) {
  const { t } = usePreferences();

  if (!authenticated) {
    return (
      <button className="button primary compact" type="button" onClick={login}>
        <Wallet size={14} aria-hidden="true" /> {t.common.connectWallet}
      </button>
    );
  }
  if (!isRecipient) {
    return (
      <span className="hint-inline" style={{ color: 'var(--muted)', fontSize: 13 }}>
        {t.stream.notRecipient}
      </span>
    );
  }
  return (
    <button
      className="button primary compact"
      type="button"
      disabled={!hasClaimable || claiming || !hasVault}
      onClick={claim}
    >
      {claiming ? t.recipient.claiming : t.stream.claimTokens}
    </button>
  );
}
