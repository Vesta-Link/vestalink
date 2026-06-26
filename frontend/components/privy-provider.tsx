"use client";

import { PrivyProvider, useLogin, usePrivy } from "@privy-io/react-auth";
import {
  toSolanaWalletConnectors,
  useWallets
} from "@privy-io/react-auth/solana";
import { UserPill } from "@privy-io/react-auth/ui";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import { ReactNode, useMemo } from "react";

import { usePreferences } from "@/components/preferences-provider";
import { RPC_URL, shorten } from "@/lib/vesting";

const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
const rpcSubscriptionsUrl = RPC_URL.replace(/^http/, "ws");
export const PRIVY_CONFIGURED = Boolean(privyAppId);

export function PrivySolanaProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { theme } = usePreferences();

  if (!PRIVY_CONFIGURED) {
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={privyAppId || "missing-privy-app-id"}
      config={{
        solana: {
          rpcs: {
            "solana:devnet": {
              rpc: createSolanaRpc(RPC_URL),
              rpcSubscriptions: createSolanaRpcSubscriptions(rpcSubscriptionsUrl)
            }
          }
        },
        appearance: {
          showWalletLoginFirst: true,
          walletChainType: "solana-only",
          theme,
          accentColor: "#080808"
        },
        loginMethods: ["wallet", "email"],
        externalWallets: {
          solana: {
            connectors: toSolanaWalletConnectors()
          }
        }
      }}
    >
      {children}
    </PrivyProvider>
  );
}

export function ConnectButton() {
  if (!PRIVY_CONFIGURED) {
    return (
      <button className="button primary" type="button" disabled title="Set NEXT_PUBLIC_PRIVY_APP_ID">
        Privy app ID needed
      </button>
    );
  }

  return <PrivyConnectButton />;
}

function PrivyConnectButton() {
  const { ready, authenticated, user } = usePrivy();
  const { login } = useLogin();
  const { wallet, address } = useActiveSolanaWallet();
  const { t } = usePreferences();

  if (!ready) {
    return (
      <button className="button primary" type="button" disabled>
        {t.common.loading}
      </button>
    );
  }

  if (!authenticated) {
    return (
      <button className="button primary" type="button" onClick={login}>
        {t.common.connect}
      </button>
    );
  }

  return (
    <div className="privy-user-pill">
      <UserPill
        expanded
        label={address ? shorten(address) : wallet?.standardWallet.name ?? user?.email?.address}
        ui={{ minimal: true, background: "accent" }}
      />
    </div>
  );
}

export function useActiveSolanaWallet() {
  const { wallets, ready } = useWallets();
  const wallet = useMemo(() => {
    const external = wallets.find((item) => item.standardWallet.name !== "Privy");
    return external ?? wallets[0];
  }, [wallets]);

  return {
    ready,
    wallet,
    address: wallet?.address,
    publicKey: wallet?.address ? new PublicKey(wallet.address) : null
  };
}

export { useSignAndSendTransaction } from "@privy-io/react-auth/solana";
