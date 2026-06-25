"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import bs58 from "bs58";
import { Wallet } from "lucide-react";
import Link from "next/link";

import { usePrivy } from "@privy-io/react-auth";

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
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  if (!PRIVY_CONFIGURED) {
    return (
      <main className="page-shell single-column">
        <section className="panel">
          <p className="eyebrow">Stream Detail</p>
          <h1>Privy app ID required</h1>
          <p className="muted">
            Set NEXT_PUBLIC_PRIVY_APP_ID in frontend/.env.local to connect wallets and claim vested
            tokens.
          </p>
        </section>
      </main>
    );
  }

  if (!id) {
    return (
      <main className="page-shell single-column">
        <section className="panel">
          <h1>Invalid Stream Link</h1>
          <p className="muted">No stream ID was provided in the URL.</p>
        </section>
      </main>
    );
  }

  return <StreamDetailPageInner id={id} />;
}

function StreamDetailPageInner({ id }: Readonly<{ id: string }>) {
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
          if (!data) throw new Error("Stream not found or invalid ID.");
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
  }, [connection, id]);

  async function claim() {
    if (!stream) return;
    if (!wallet || !publicKey) {
      setError("Connect the recipient wallet first.");
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
      setSuccess(`Claimed ${rawToDecimal(stream.claimableRaw, stream.decimals)} tokens.`);

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
      <div className="skeleton-list" aria-label="Loading stream">
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
        <strong>Stream Not Found</strong>
        <p>Make sure you have the correct link.</p>
      </div>
    );
  }

  return (
    <main className="page-shell single-column">
      <section className="panel dashboard-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Claim Tokens</p>
            <h1>Vesting Stream</h1>
            <p className="muted">
              Connect your wallet to claim unlocked tokens from this stream.
            </p>
          </div>
        </div>

        {error && <p className="message error">{error}</p>}
        {success && <p className="message success">{success}</p>}

        {streamContent}

        {stream && authenticated && isRecipient && (
          <div style={{ marginTop: 24, textAlign: 'center' }}>
            <Link href="/recipient" className="button secondary">
              View All Your Streams
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
  if (!authenticated) {
    return (
      <button className="button primary compact" type="button" onClick={login}>
        <Wallet size={14} /> Connect Wallet
      </button>
    );
  }
  if (!isRecipient) {
    return (
      <span className="hint-inline" style={{ color: 'var(--muted)', fontSize: 13 }}>
        Not recipient wallet
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
      {claiming ? "Claiming..." : "Claim Tokens"}
    </button>
  );
}
