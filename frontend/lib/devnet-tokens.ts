import { VESTA_MINT } from "./vesting";

export type DevnetToken = {
  symbol: string;
  name: string;
  mint: string;
  decimals?: number;
  isFaucetToken?: boolean;
  description?: string;
};

export const DEVNET_TOKENS: DevnetToken[] = [
  {
    symbol: "VESTA",
    name: "Vesta Test Token",
    mint: VESTA_MINT.toBase58(),
    decimals: 6,
    isFaucetToken: true,
    description: "Devnet dummy SPL token for testing the vesting workflow."
  },
  {
    symbol: "USDC",
    name: "Devnet USDC",
    mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    decimals: 6,
    description: "Common Solana devnet USDC mint."
  },
  {
    symbol: "wSOL",
    name: "Wrapped SOL",
    mint: "So11111111111111111111111111111111111111112",
    decimals: 9,
    description: "Native wrapped SOL mint used across Solana clusters."
  }
];
