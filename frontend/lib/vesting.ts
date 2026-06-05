import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  getMint
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction
} from "@solana/web3.js";

import { VESTALINK_IDL } from "./idl";

export const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_VESTALINK_PROGRAM_ID ?? VESTALINK_IDL.address
);
export const EXPLORER_CLUSTER = "devnet";
export const VESTA_MINT = new PublicKey("4zFYPYxDAio8BDPqfpAWhEMzpyPANxJABmbWPmBq6LKx");
export const VESTA_FAUCET_AMOUNT = "10000";

export type AppWallet = {
  publicKey: PublicKey;
};

export type VestalinkAccount = {
  recipient: PublicKey;
  funder: PublicKey;
  totalAmount: anchor.BN;
  claimedAmount: anchor.BN;
  authorityRevoker: PublicKey;
  authorityMilestone: PublicKey;
  treasuryReturnAddress: PublicKey;
  vestingType: unknown;
  isRevoked: boolean;
  startTime: anchor.BN;
  endTime: anchor.BN;
  cliffTime: anchor.BN;
  milestoneCount: number;
  milestonesReached: number;
  bump: number;
  nonce: anchor.BN;
  vestedAmountAtRevocation: anchor.BN;
};

export type StreamView = {
  publicKey: PublicKey;
  account: VestalinkAccount;
  vault?: PublicKey;
  mint?: PublicKey;
  decimals: number;
  symbol: string;
  unlockedRaw: bigint;
  claimableRaw: bigint;
  lockedRaw: bigint;
  progress: number;
  status: "pending" | "active" | "complete" | "revoked";
};

export type RecipientInput = {
  recipient: PublicKey;
  amountRaw: anchor.BN;
  nonce: anchor.BN;
  vestingState: PublicKey;
  vault: PublicKey;
};

export function getConnection() {
  return new Connection(RPC_URL, "confirmed");
}

export function shorten(address: PublicKey | string, chars = 4) {
  const value = typeof address === "string" ? address : address.toBase58();
  return `${value.slice(0, chars)}...${value.slice(-chars)}`;
}

export function explorerUrl(signatureOrAddress: string, type: "tx" | "address" = "address") {
  return `https://explorer.solana.com/${type}/${signatureOrAddress}?cluster=${EXPLORER_CLUSTER}`;
}

export function getProvider(connection: Connection, wallet: AppWallet) {
  const readonlyWallet = {
    publicKey: wallet.publicKey,
    signTransaction: async () => {
      throw new Error("Signing is handled by Privy.");
    },
    signAllTransactions: async () => {
      throw new Error("Signing is handled by Privy.");
    }
  };

  return new anchor.AnchorProvider(connection, readonlyWallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed"
  });
}

export function getProgram(provider: anchor.AnchorProvider) {
  return new anchor.Program(VESTALINK_IDL, provider);
}

export function parseCsvRows(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [wallet, amount] = line.split(",").map((part) => part.trim());
      if (!wallet || !amount) {
        throw new Error(`Invalid row: "${line}". Use wallet,amount.`);
      }
      return { wallet, amount };
    });
}

export function decimalToRaw(amount: string, decimals: number) {
  const normalized = amount.replaceAll(',', "").trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid amount "${amount}".`);
  }

  const [whole, fractional = ""] = normalized.split(".");
  if (fractional.length > decimals) {
    throw new Error(`Amount "${amount}" has more than ${decimals} decimals.`);
  }

  const raw = `${whole}${fractional.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
  return new anchor.BN(raw || "0");
}

export function rawToDecimal(raw: bigint | anchor.BN | number, decimals: number) {
  const value = typeof raw === "bigint" ? raw : BigInt(raw.toString());
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  if (fraction === 0n) return whole.toString();

  const fractional = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fractional}`;
}

export function formatDateTime(seconds: anchor.BN | number) {
  const value = typeof seconds === "number" ? seconds : seconds.toNumber();
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value * 1000));
}

export function deriveVestingPda(funder: PublicKey, recipient: PublicKey, nonce: anchor.BN) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("vesting"),
      funder.toBuffer(),
      recipient.toBuffer(),
      nonce.toArrayLike(Buffer, "le", 8)
    ],
    PROGRAM_ID
  )[0];
}

export function deriveVestaFaucetPda() {
  return PublicKey.findProgramAddressSync([Buffer.from("vesta_faucet")], PROGRAM_ID)[0];
}

export function randomNonce() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  bytes[7] = bytes[7] & 0x7f;
  return new anchor.BN(Buffer.from(bytes), "le");
}

export async function resolveTokenDecimals(connection: Connection, mint: PublicKey) {
  const mintInfo = await getMint(connection, mint);
  return mintInfo.decimals;
}

export async function buildCreateStreamTransaction(params: {
  connection: Connection;
  wallet: AppWallet;
  mint: PublicKey;
  rows: { wallet: string; amount: string }[];
  startTime: number;
  endTime: number;
  cliffTime?: number;
}) {
  const provider = getProvider(params.connection, params.wallet);
  const program = getProgram(provider);
  const decimals = await resolveTokenDecimals(params.connection, params.mint);
  const transaction = new Transaction();
  const streams: RecipientInput[] = [];

  if (params.startTime >= params.endTime) {
    throw new Error("Start time must be before end time.");
  }

  for (const row of params.rows) {
    const recipient = new PublicKey(row.wallet);
    const amountRaw = decimalToRaw(row.amount, decimals);
    if (amountRaw.lten(0)) throw new Error(`Amount for ${row.wallet} must be greater than zero.`);

    const nonce = randomNonce();
    const vestingState = deriveVestingPda(params.wallet.publicKey, recipient, nonce);
    const funderTokenAccount = getAssociatedTokenAddressSync(params.mint, params.wallet.publicKey);
    const vault = getAssociatedTokenAddressSync(params.mint, vestingState, true);

    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(
        params.wallet.publicKey,
        vault,
        vestingState,
        params.mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    const resolvedCliff = params.cliffTime ?? params.startTime;
    const vestingType =
      resolvedCliff > params.startTime ? { cliff: {} } : { linear: {} };

    const instruction = await program.methods
      .createStream({
        totalAmount: amountRaw,
        vestingType,
        startTime: new anchor.BN(params.startTime),
        endTime: new anchor.BN(params.endTime),
        cliffTime: new anchor.BN(resolvedCliff),
        milestoneCount: 0,
        nonce
      })
      .accountsPartial({
        vestingState,
        funder: params.wallet.publicKey,
        recipient,
        funderTokenAccount,
        vestingTokenAccount: vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId
      })
      .instruction();

    transaction.add(instruction);
    streams.push({ recipient, amountRaw, nonce, vestingState, vault });
  }

  return { transaction, streams };
}

export async function buildWithdrawTransaction(params: {
  connection: Connection;
  wallet: AppWallet;
  stream: StreamView;
}) {
  if (!params.stream.vault || !params.stream.mint) {
    throw new Error("Vault token account could not be resolved for this stream.");
  }

  const provider = getProvider(params.connection, params.wallet);
  const program = getProgram(provider);
  const recipientTokenAccount = getAssociatedTokenAddressSync(
    params.stream.mint,
    params.wallet.publicKey
  );

  const createRecipientAta = createAssociatedTokenAccountIdempotentInstruction(
    params.wallet.publicKey,
    recipientTokenAccount,
    params.wallet.publicKey,
    params.stream.mint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const withdraw = await program.methods
    .withdraw()
    .accountsPartial({
      vestingState: params.stream.publicKey,
      recipient: params.wallet.publicKey,
      recipientTokenAccount,
      vestingTokenAccount: params.stream.vault,
      tokenProgram: TOKEN_PROGRAM_ID
    })
    .instruction();

  return new Transaction().add(createRecipientAta, withdraw);
}

export async function buildCancelStreamTransaction(params: {
  connection: Connection;
  wallet: AppWallet;
  stream: StreamView;
}) {
  if (!params.stream.vault || !params.stream.mint) {
    throw new Error("Vault token account could not be resolved for this stream.");
  }

  const provider = getProvider(params.connection, params.wallet);
  const program = getProgram(provider);

  // The treasury return address was set at creation time to the funder's ATA
  const treasuryReturnAddress = params.stream.account.treasuryReturnAddress;

  const cancel = await program.methods
    .cancelStream()
    .accountsPartial({
      vestingState: params.stream.publicKey,
      authorityRevoker: params.wallet.publicKey,
      treasuryReturnAddress,
      vestingTokenAccount: params.stream.vault,
      tokenProgram: TOKEN_PROGRAM_ID
    })
    .instruction();

  return new Transaction().add(cancel);
}

export async function buildRequestVestaTransaction(params: {
  connection: Connection;
  wallet: AppWallet;
}) {
  const provider = getProvider(params.connection, params.wallet);
  const program = getProgram(provider);
  const requesterTokenAccount = getAssociatedTokenAddressSync(VESTA_MINT, params.wallet.publicKey);
  const faucetAuthority = deriveVestaFaucetPda();

  const createRequesterAta = createAssociatedTokenAccountIdempotentInstruction(
    params.wallet.publicKey,
    requesterTokenAccount,
    params.wallet.publicKey,
    VESTA_MINT,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const requestVesta = await program.methods
    .requestVesta()
    .accountsPartial({
      requester: params.wallet.publicKey,
      vestaMint: VESTA_MINT,
      requesterTokenAccount,
      faucetAuthority,
      tokenProgram: TOKEN_PROGRAM_ID
    })
    .instruction();

  return new Transaction().add(createRequesterAta, requestVesta);
}

export async function prepareUnsignedTransaction(params: {
  connection: Connection;
  transaction: Transaction;
  feePayer: PublicKey;
}) {
  const { blockhash, lastValidBlockHeight } = await params.connection.getLatestBlockhash("confirmed");
  params.transaction.feePayer = params.feePayer;
  params.transaction.recentBlockhash = blockhash;

  return {
    bytes: params.transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false
    }),
    blockhash,
    lastValidBlockHeight
  };
}

export async function fetchStreams(connection: Connection) {
  const provider = getProvider(connection, {
    publicKey: PublicKey.default
  });
  const program = getProgram(provider);
  const rows = (await (program.account as any).vestingState.all()) as Array<{
    publicKey: PublicKey;
    account: VestalinkAccount;
  }>;

  return Promise.all(
    rows.map(async (row) => {
      const account = row.account;
      const now = Math.floor(Date.now() / 1000);
      const total = BigInt(account.totalAmount.toString());
      const claimed = BigInt(account.claimedAmount.toString());
      const start = account.startTime.toNumber();
      const end = account.endTime.toNumber();
      const unlockedRaw = calculateUnlocked(total, start, end, now, account);
      const claimableRaw = unlockedRaw > claimed ? unlockedRaw - claimed : 0n;
      const lockedRaw = total > unlockedRaw ? total - unlockedRaw : 0n;
      const progress = total === 0n ? 0 : Number((unlockedRaw * 10_000n) / total) / 100;
      const token = await resolveVault(connection, row.publicKey);

      return {
        publicKey: row.publicKey,
        account,
        vault: token?.vault,
        mint: token?.mint,
        decimals: token?.decimals ?? 0,
        symbol: token?.symbol ?? "tokens",
        unlockedRaw,
        claimableRaw,
        lockedRaw,
        progress,
        status: getStatus(now, start, end, account)
      } satisfies StreamView;
    })
  );
}

function calculateUnlocked(
  total: bigint,
  start: number,
  end: number,
  now: number,
  account: VestalinkAccount
) {
  if (account.isRevoked) return BigInt(account.vestedAmountAtRevocation.toString());
  if (now <= start) return 0n;
  if (now >= end) return total;

  return (total * BigInt(now - start)) / BigInt(end - start);
}

function getStatus(now: number, start: number, end: number, account: VestalinkAccount) {
  if (account.isRevoked) return "revoked";
  if (now < start) return "pending";
  if (now >= end) return "complete";
  return "active";
}

async function resolveVault(connection: Connection, vestingState: PublicKey) {
  const accounts = await connection.getParsedTokenAccountsByOwner(vestingState, {
    programId: TOKEN_PROGRAM_ID
  });

  const first = accounts.value[0];
  if (!first) return undefined;

  const mint = new PublicKey(first.account.data.parsed.info.mint);
  const mintInfo = await getMint(connection, mint);
  return {
    vault: first.pubkey,
    mint,
    decimals: mintInfo.decimals,
    symbol: shorten(mint)
  };
}

export function serializeTransactionError(error: unknown) {
  const stringifiedError = typeof error === "string" ? error : "";
  const rawMessage = error instanceof Error ? error.message : stringifiedError;
  const message = rawMessage.toLowerCase();

  if (/reject|cancel|declined|denied/.test(message)) {
    return "Transaction was rejected in your wallet.";
  }

  if (/insufficient|0x1|attempt to debit|no prior credit|funds/.test(message)) {
    return "Your wallet does not have enough devnet SOL to pay transaction fees. Please request devnet SOL and try again.";
  }

  if (/method not found|unknown instruction|instruction fallback|requestvesta|request_vesta/.test(message)) {
    return "The deployed contract does not support Request VESTA yet. Please contact the team.";
  }

  if (/blockhash|timeout|network|fetch|rpc|503|504|429/.test(message)) {
    return "Devnet RPC is not responding. Please wait a moment and try again.";
  }

  if (/mint|token account|owner does not match|invalid account data/.test(message)) {
    return "VESTA token setup is not valid. Please contact the team.";
  }

  if (/internal error|unexpected error/.test(message)) {
    return "Something went wrong while sending the transaction. Please try again or share this error with the team.";
  }

  if (rawMessage) return rawMessage;
  return "Transaction failed. Please try again.";
}

export function isWalletCancellation(error: unknown) {
  return error instanceof Error && /reject|cancel/i.test(error.message);
}

export function addComputeBudget(_instructions: TransactionInstruction[]) {
  return;
}
