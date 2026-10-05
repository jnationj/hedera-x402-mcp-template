# x402 Pay-Per-Use Template (Hedera)

This template combines Scaffold-HBAR, Solidity smart contracts, a private MinIO storage layer, an x402 pay-per-use resource server, a self-hosted Hedera facilitator, and a browser-based HashPack flow for file access and paid MCP tools.

The project is designed for Hedera testnet use and is intended for local experimentation and developer validation. It is not an audited production deployment.

## Scaffold this template

Create a new Scaffold-HBAR project from this repository:

```bash
npm create scaffold-hbar@latest -- --template jnationj/hedera-x402-mcp-template
```

This template provides a Hedera x402 + MCP application built with Next.js and Hardhat, including on-chain FileRegistry and Policy402 contracts, HBAR payments, private file storage, and off-chain file integrity verification. Local development requires Docker, MinIO, a local x402 facilitator, and a funded Hedera testnet account.

## What this template provides

- Hedera Scaffold-HBAR app shell
- `FileRegistry` smart contract for file metadata and access terms
- `Policy402` V1 contract for versioned payment policies
- private MinIO-backed file storage
- x402-based protected download flow for private files
- self-hosted facilitator for verifying and settling HBAR payments
- paid MCP endpoint using Streamable HTTP and `@x402/mcp`
- HashPack native Hedera wallet signing for both contract writes and payments

## Architecture

### Upload flow

Browser → MinIO presigned upload → `FileRegistry.registerFile` → file ID

### Policy flow

Registered file → canonical service ID → `Policy402.createPolicy` → payment policy

### Private download flow

Client → protected download API → Policy402 validation → x402 challenge → facilitator → HBAR settlement → signed MinIO URL

### MCP flow

Client → `/api/mcp` → paid `get_service_info` tool → x402 challenge → HBAR settlement → tool response

## Features

- Public and private file registration
- On-chain metadata and pricing in `FileRegistry`
- `Policy402` V1 payment-policy attestation per registered file
- Policy versioning and version-level revocation
- Canonical service ID derived from the file resource descriptor
- x402 private downloads with native HBAR settlement
- paid MCP tool via Streamable HTTP
- HashPack and native Hedera wallet signing
- Hedera testnet deployment and verification

## Routes

Core app routes and API routes in the current project:

- `/` — landing page
- `/files/upload` — file upload workflow
- `/files/[id]` — file detail and access logic
- `/createpolicy` — create a Policy402 V1 policy for an existing file
- `/revokepolicy` — revoke the current policy version for an existing file
- `/mcp-test` — browser demo for the paid MCP flow
- `/debug` — debug utilities and live contract info
- `/debug/policy` — Policy402 debug and validation utilities

API routes:

- `/api/files/upload` — presigned MinIO PUT URL
- `/api/files/[id]/download` — public/private download route with x402 gate
- `/api/mcp` — Streamable HTTP MCP endpoint for the paid tool

## Smart contracts

### `FileRegistry`

`FileRegistry` stores file metadata on Hedera and is the canonical source for file ownership, access terms, and object references. The file bytes remain in private MinIO storage; on-chain state stores the object key, content hash, owner, price, and visibility fields.

### `Policy402`

`Policy402` is the V1 policy contract used for resource-level payment policy attestation. It is explicitly scoped to the current V1 behavior:

- one file → one current policy
- policy created for an existing `FileRegistry` file
- canonical service ID derived from the file resource descriptor
- owner authorization required for creation and revocation
- versioned policy lifecycle
- version-level revocation
- creating a new active version after revoking an old version is allowed
- no V2 mutation/reactivation behavior is part of V1

This matches the current contract logic in `packages/hardhat/contracts/Policy402.sol`.

## Current verified testnet deployments

The current deployment metadata in `packages/nextjs/contracts/deployedContracts.ts` contains these active contracts on Hedera testnet:

- FileRegistry
  - EVM: `0xEbdCf8DaE6E7962c38EBfE3c75BC75aA7F562357`
  - Hedera: `0.0.10858803`
- Policy402 V1
  - EVM: `0xF28dD385aB3288f6c11423994968317dA4Be09B8`
  - Hedera: `0.0.10862565`

These are the current public deployment values this repo expects for the live testnet flow.

### Hedera testnet deployment transaction evidence

These deployment transaction hashes are recorded in the project's Hedera testnet deployment artifacts:

- FileRegistry deployment transaction: `0x8b041c25d68702f7d67e25c9948e6bf1d74e296603e29b9f03f95cb275928325`
- Policy402 deployment transaction: `0xc6ffbb1f71c402301941804d9704f8aa21c8d5ba02696349b2186920e7c1dcf1`

Associated contracts:

- FileRegistry: `0xEbdCf8DaE6E7962c38EBfE3c75BC75aA7F562357` / Hedera `0.0.10858803`
- Policy402: `0xF28dD385aB3288f6c11423994968317dA4Be09B8` / Hedera `0.0.10862565`

## Policy workflow

1. Upload and register a file.
2. Open `/createpolicy`.
3. Select or load the registered file by FileRegistry ID.
4. Confirm the connected wallet owns the file.
5. Set validity and payment details.
6. Sign with HashPack.
7. Wait for Hedera confirmation.
8. Read back the created policy.
9. Use the protected resource or download flow.
10. Revoke from `/revokepolicy` when needed.

## MCP workflow

Use the browser demo at `/mcp-test`.

Requirements:

- connected HashPack wallet
- valid Hedera testnet account
- running local facilitator and app infrastructure

The demo calls the paid `get_service_info` MCP tool over Streamable HTTP. The wallet approves the native HBAR transfer, the facilitator verifies and settles the payment, and the tool result is returned in the browser.

Do not bypass the UI with custom raw HTTP examples in normal usage; the supported path is the browser demo page that uses the verified x402 flow.

## Configuration

This project uses a small set of actual environment values that are required for current local/testnet operation.

### Root `.env`

- `MINIO_ROOT_USER`
- `MINIO_ROOT_PASSWORD`
- `S3_BUCKET`
- `FACILITATOR_PORT`
- `X402_NETWORK`
- `FACILITATOR_ACCOUNT_ID`
- `FACILITATOR_PRIVATE_KEY`
- `HEDERA_NODE_URL` (optional)

### `packages/nextjs/.env`

- `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID`
- `FACILITATOR_URL`
- `X402_NETWORK`
- `NEXT_PUBLIC_X402_NETWORK`
- `HEDERA_RPC_URL`
- `S3_ENDPOINT`
- `S3_BUCKET`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_FORCE_PATH_STYLE`
- `X402_MCP_PAY_TO`
- `NEXT_PUBLIC_X402_MCP_PAY_TO`

Never commit or expose real wallet keys, facilitator secrets, mnemonics, or API tokens.

## Quick start

1. Install dependencies:

```bash
corepack enable
corepack prepare yarn@3.2.3 --activate
yarn install
```

2. Copy environment files:

```bash
Copy-Item .env.example .env
Copy-Item packages\nextjs\.env.example packages\nextjs\.env
```

3. Configure the local Docker environment and ensure `minio.license` exists at the repo root.

4. Deploy to Hedera testnet when needed:

```bash
yarn hardhat:deploy --network hederaTestnet
yarn hardhat:verify:testnet
```

5. Start local services:

```bash
yarn infra:up
yarn next:dev
```

6. Open http://localhost:3000 and use the app.

## Local infrastructure

The repo uses Docker Compose to run:

- MinIO private storage on `:9000` and `:9001`
- self-hosted x402 facilitator on `:4020`

The stack is started with:

```bash
yarn infra:up
yarn infra:down
yarn infra:logs
```

## Developer notes

- The x402 resource server does not hold the facilitator private key.
- Payment amounts are tinybars and use native HBAR with asset id `0.0.0`.
- The app uses the `hedera` namespace for HashPack and native signing flows.
- The MCP demo is a local testnet reference flow, not a production external service.

## Links

- [x402](https://x402.org/)
- [Hedera Documentation](https://docs.hedera.com/)
- [Hashscan](https://hashscan.io/)
- [Hedera Portal Faucet](https://portal.hedera.com/faucet)
- [Scaffold-HBAR](https://docs.hedera.com/solutions/tools/scaffold-hbar/index)
- [RUNBOOK.md](RUNBOOK.md)