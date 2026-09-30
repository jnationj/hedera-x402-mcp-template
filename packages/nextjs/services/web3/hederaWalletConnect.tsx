"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getHederaAccountIdFromSession, getHederaProvider, hasHederaSession, initAppKit } from "./appKitHedera";
import type { HederaProvider } from "@hashgraph/hedera-wallet-connect";
import { hederaNamespace } from "@hashgraph/hedera-wallet-connect";
import { useAppKitAccount, useDisconnect } from "@reown/appkit/react";
import { parseHederaAccountId } from "~~/utils/scaffold-hbar/hederaAccountId";

type HederaWalletConnectContextValue = {
  provider: HederaProvider | null;
  /** Native Hedera account id from the WalletConnect session. */
  hederaAccountId: string | null;
  /** Alias of `hederaAccountId` for display components. */
  accountId: string | null;
  hasHederaSession: boolean;
  isConnected: boolean;
  isInitializing: boolean;
  isBusy: boolean;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
};

const HederaWalletConnectContext = createContext<HederaWalletConnectContextValue | undefined>(undefined);

let initPromise: Promise<HederaProvider> | null = null;

/** Initialise AppKit + HederaProvider once for the page lifetime (AppKit is a module singleton). */
function ensureInit(): Promise<HederaProvider> {
  if (!initPromise) {
    initPromise = initAppKit().then(() => getHederaProvider());
  }
  return initPromise;
}

export const HederaWalletConnectProvider = ({ children }: { children: React.ReactNode }) => {
  const { disconnect } = useDisconnect();
  const [provider, setProvider] = useState<HederaProvider | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  /** Bumps when the WC provider session or AppKit account state changes. */
  const [sessionTick, setSessionTick] = useState(0);
  const { address: appKitHederaAddress, isConnected: appKitHederaConnected } = useAppKitAccount({
    namespace: hederaNamespace,
  });

  useEffect(() => {
    let mounted = true;
    void ensureInit()
      .then(hp => {
        if (mounted) setProvider(hp);
      })
      .catch(err => console.error("HederaWalletConnect init failed", err))
      .finally(() => {
        if (mounted) setIsInitializing(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!provider) return;
    const bump = () => setSessionTick(t => t + 1);
    const providerWithEvents = provider as unknown as {
      on?: (event: string, cb: () => void) => void;
      off?: (event: string, cb: () => void) => void;
    };

    if (typeof providerWithEvents.on === "function") {
      providerWithEvents.on("session_update", bump);
      providerWithEvents.on("session_delete", bump);
      providerWithEvents.on("connect", bump);
      providerWithEvents.on("disconnect", bump);
    }
    return () => {
      if (typeof providerWithEvents.off === "function") {
        providerWithEvents.off("session_update", bump);
        providerWithEvents.off("session_delete", bump);
        providerWithEvents.off("connect", bump);
        providerWithEvents.off("disconnect", bump);
      }
    };
  }, [provider]);

  useEffect(() => {
    setSessionTick(t => t + 1);
  }, [appKitHederaConnected, appKitHederaAddress]);

  const disconnectWallet = useCallback(async () => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      await disconnect({ namespace: hederaNamespace });
    } catch (error) {
      console.error("HashPack disconnect failed", error);
    } finally {
      setSessionTick(t => t + 1);
      setIsBusy(false);
    }
  }, [isBusy, disconnect]);

  const connectWallet = useCallback(async () => Promise.resolve(), []);

  const { hederaAccountId, hederaSessionReady, isConnected } = useMemo(() => {
    void sessionTick;

    const fromProvider = getHederaAccountIdFromSession(provider);
    const fromAppKit = appKitHederaConnected && appKitHederaAddress ? parseHederaAccountId(appKitHederaAddress) : null;
    const accountId = fromProvider ?? fromAppKit;
    const sessionReady = hasHederaSession(provider);
    const connected = Boolean(appKitHederaConnected && accountId);

    return {
      hederaAccountId: accountId,
      hederaSessionReady: sessionReady,
      isConnected: connected,
    };
  }, [sessionTick, provider, appKitHederaConnected, appKitHederaAddress]);

  const value = useMemo<HederaWalletConnectContextValue>(
    () => ({
      provider,
      hederaAccountId,
      accountId: hederaAccountId,
      hasHederaSession: hederaSessionReady,
      isConnected,
      isInitializing,
      isBusy,
      connectWallet,
      disconnectWallet,
    }),
    [
      provider,
      hederaAccountId,
      hederaSessionReady,
      isConnected,
      isInitializing,
      isBusy,
      connectWallet,
      disconnectWallet,
    ],
  );

  if (isInitializing) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="loading loading-spinner loading-md text-primary" />
      </div>
    );
  }

  return <HederaWalletConnectContext.Provider value={value}>{children}</HederaWalletConnectContext.Provider>;
};

export const useHederaWalletConnect = () => {
  const ctx = useContext(HederaWalletConnectContext);
  if (!ctx) throw new Error("useHederaWalletConnect must be used inside HederaWalletConnectProvider");
  return ctx;
};
