# x402 Hedera Facilitator (self-hosted)

A minimal, self-hosted [x402](https://docs.x402.org) facilitator for Hedera. It wraps the
official Hedera reference scheme from [`@x402/hedera`](https://www.npmjs.com/package/@x402/hedera)
(`exact/facilitator`) with the generic engine from `@x402/core/facilitator`, so there is **no
third-party service in the payment path** — you run Hedera's own reference code.

## What it does

It exposes the three endpoints an x402 resource server expects:

| Method | Path         | Purpose                                                                 |
| ------ | ------------ | ----------------------------------------------------------------------- |
| `GET`  | `/supported` | Advertises supported payment kinds and the fee-payer account it sponsors |
| `POST` | `/verify`    | Validates a signed payment payload against the requirements              |
| `POST` | `/settle`    | Adds the fee-payer signature, submits to Hedera, awaits a SUCCESS receipt |
| `GET`  | `/health`    | Liveness check                                                           |

The facilitator is **non-custodial**: it can only add its fee-payer signature to a transfer the
buyer already authorized. It never holds files or the buyer's funds.

### Why `FACILITATOR_PRIVATE_KEY` is required

Hedera x402 uses native `TransferTransaction`s. The buyer’s wallet (e.g. HashPack) partially
signs — authorizing movement of HBAR from buyer → seller. The transaction is also bound to a
**fee payer** account (advertised via `/supported`). At settle time the facilitator must:

1. Verify the buyer’s signature matches the payment requirements.
2. Co-sign as that fee payer.
3. Pay Hedera network fees and submit the transaction to consensus.

That requires a funded ECDSA account and its private key on the facilitator process. The
resource server (Next.js) only talks to this service over HTTP; it never sees the key.

## Running

It is normally started via the repo-root `docker-compose.yml` (`yarn infra:up`). To run it
standalone:

```bash
cp .env.example .env   # fill in FACILITATOR_ACCOUNT_ID / FACILITATOR_PRIVATE_KEY
npm install
npm start
```

## Configuration

| Env var                  | Default          | Description                                              |
| ------------------------ | ---------------- | -------------------------------------------------------- |
| `PORT`                   | `4020`           | HTTP port                                                |
| `X402_NETWORK`           | `hedera:testnet` | CAIP-2 network to settle on                              |
| `FACILITATOR_ACCOUNT_ID` | _(required)_     | ECDSA fee-payer account id (funded with HBAR); advertised to clients |
| `FACILITATOR_PRIVATE_KEY`| _(required)_     | ECDSA key for co-signing and submitting settled transfers |
| `HEDERA_NODE_URL`        | _(optional)_     | Custom consensus node endpoint for private Hedera setups |

The fee-payer account must be a real, funded **ECDSA** account dedicated to the facilitator.
It pays Hedera network fees for every settled payment. Use a separate account from your
contract deployer or seller wallets.
