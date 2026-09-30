import type { HederaProvider } from "@hashgraph/hedera-wallet-connect";
import type { PaymentRequirements } from "@x402/core/types";
import type { ClientHederaSigner, HederaClientSignerConfig } from "@x402/hedera";
import { X402_CLIENT_NETWORK } from "~~/services/x402/client";

/**
 * x402 client signer that partially signs Hedera transfers via Hedera WalletConnect
 * (`hedera_signTransaction`), e.g. HashPack.
 */
export function createHederaProviderSigner(
  accountId: string,
  provider: HederaProvider,
  config: HederaClientSignerConfig = {},
): ClientHederaSigner {
  const configuredNetwork = config.network ?? X402_CLIENT_NETWORK;

  return {
    accountId,
    createPartiallySignedTransferTransaction: async (requirements: PaymentRequirements) => {
      const [{ AccountId, Hbar, TokenId, TransactionId, TransferTransaction }, hedera] = await Promise.all([
        import("@hiero-ledger/sdk"),
        import("@x402/hedera"),
      ]);

      if (!hedera.isSupportedHederaNetwork(requirements.network)) {
        throw new Error(`Unsupported Hedera network: ${requirements.network}`);
      }
      const feePayer = requirements.extra?.feePayer;
      if (typeof feePayer !== "string") {
        throw new Error("feePayer is required in paymentRequirements.extra");
      }

      const amount = BigInt(requirements.amount);
      if (amount <= 0n) {
        throw new Error("amount must be greater than zero");
      }

      const payer = AccountId.fromString(accountId);
      const payTo = AccountId.fromString(requirements.payTo);
      const tx = new TransferTransaction();

      if (hedera.isHbarAsset(requirements.asset)) {
        tx.addHbarTransfer(payer, Hbar.fromTinybars((-amount).toString()));
        tx.addHbarTransfer(payTo, Hbar.fromTinybars(amount.toString()));
      } else {
        const tokenId = TokenId.fromString(requirements.asset);
        tx.addTokenTransfer(tokenId, payer, -amount);
        tx.addTokenTransfer(tokenId, payTo, amount);
      }

      tx.setTransactionId(TransactionId.generate(AccountId.fromString(feePayer)));

      // Use HederaProvider helper so the SDK Transaction is serialized to the
      // base64 transactionBody HashPack expects (not a raw SDK object over WC).
      const signed = await provider.hedera_signTransaction({
        signerAccountId: `${requirements.network}:${accountId}`,
        transactionBody: tx,
      });

      return Buffer.from(signed.toBytes()).toString("base64");
    },
  };
}

/** @deprecated use createHederaProviderSigner */
export const createUniversalProviderHederaSigner = createHederaProviderSigner;
