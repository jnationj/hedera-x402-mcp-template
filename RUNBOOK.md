# x402 Pay-Per-Use Template — Operator Runbook

This runbook reflects the current project state and the verified runtime behavior of the repo in its current branch. Use it from the repository root unless a command explicitly says otherwise.

## 1. Prerequisites

- Node.js 20 LTS or newer (project requirement: `>= 20.18.3`)
- Yarn 3.2.3 via Corepack
- Docker Desktop / Docker Compose
- Git
- Hedera testnet account with HBAR for deployments and payments
- ECDSA account for the facilitator fee payer
- A local `minio.license` file at the repo root before `yarn infra:up`

PowerShell setup:

```powershell
corepack enable
corepack prepare yarn@3.2.3 --activate
yarn --version
```

## 2. Install dependencies

```bash
yarn install
```

If you are in PowerShell, the equivalent is:

```powershell
yarn install
```

## 3. Environment configuration

Copy the root and app env files:

```bash
cp .env.example .env
cp packages/nextjs/.env.example packages/nextjs/.env
```

In PowerShell:

```powershell
Copy-Item .env.example .env
Copy-Item packages\nextjs\.env.example packages\nextjs\.env
```

Set the required values in the root `.env`:

- `FACILITATOR_ACCOUNT_ID`
- `FACILITATOR_PRIVATE_KEY`
- `S3_BUCKET`
- `X402_NETWORK`
- `MINIO_ROOT_USER`
- `MINIO_ROOT_PASSWORD`

Set the required values in `packages/nextjs/.env`:

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

Do not commit real credentials or wallet private keys.

## 4. Start local infrastructure

The repo uses Docker Compose to start the MinIO bucket and self-hosted x402 facilitator.

```bash
yarn infra:up
```

Useful commands:

```bash
yarn infra:down
yarn infra:logs
```

Health checks:

```bash
curl -s http://localhost:4020/health
curl -s http://localhost:4020/supported
```

Expected behavior:

- facilitator responds with status metadata
- supported route advertises the `hedera:testnet` exact-scheme flow
- local MinIO console available at http://localhost:9001

## 5. Start the app

```bash
yarn next:dev
```

Open http://localhost:3000

## 6. Deploy contracts when needed

Deploy the contract set for Hedera testnet when the generated deployment metadata is missing or stale:

```bash
yarn hardhat:deploy --network hederaTestnet
```

Verify the deployment if required:

```bash
yarn hardhat:verify:testnet
```

This updates `packages/nextjs/contracts/deployedContracts.ts` with the active contract addresses and Hedera `0.0.x` ids.

## 7. Register / upload a file

Use the browser upload flow at `/files/upload`.

The upload includes:

- presigned MinIO upload URL
- upload bytes to the private bucket
- `FileRegistry.registerFile` with HashPack native signing
- file metadata stored on-chain

## 8. Create a Policy402 policy

Open `/createpolicy`.

Workflow:

1. Load an existing FileRegistry file ID.
2. Confirm the connected wallet owns the file.
3. The app derives the canonical service ID for the file.
4. Confirm the payment asset and pay-to configuration.
5. Set valid-from / valid-until values.
6. Sign the `createPolicy` transaction with HashPack.
7. Wait for Hedera confirmation.
8. Read back the policy state.

Important V1 contract boundary:

- one file → one active policy
- canonical service ID derived from the file resource descriptor
- policy ownership enforced by file owner
- versioned policy lifecycle
- version-level revocation
- no V2 reactivation behavior is part of this V1 contract

## 9. Test the protected x402 download

After creating the file policy:

- the file is protected by the resource server
- a client without a valid payment receives a `402 Payment Required`
- the x402 client signs a native HBAR transfer in the browser
- the facilitator verifies and settles the payment
- the server returns a short-lived presigned MinIO GET URL

This is the same pattern used by the private file download path.

## 10. Revoke a policy

Open `/revokepolicy`.

Workflow:

1. Load the registered file ID.
2. Confirm the connected wallet owns the file.
3. The page reads the current policy for the file.
4. Sign the revoke transaction.
5. Wait for Hedera confirmation.
6. Confirm no active policy remains for that resource.

## 11. Test paid MCP

Open `/mcp-test`.

Requirements:

- connected HashPack wallet
- Hedera testnet account with HBAR
- app and facilitator running

The page invokes the paid `get_service_info` tool over `/api/mcp` using Streamable HTTP and x402. The demo has been verified end-to-end with real settlement on Hedera testnet.

Important notes:

- A connected Hedera wallet is required.
- The demo uses native HBAR, not EVM-style signing.
- The payment is settled via the self-hosted facilitator.
- The tool result is returned only after successful payment and settlement.

## 12. Verify Hedera transactions

Useful references:

- HashScan testnet explorer
- Hedera mirror node JSON endpoint
- local facilitator logs

Current known verified deployment values:

- FileRegistry EVM: `0xEbdCf8DaE6E7962c38EBfE3c75BC75aA7F562357`
- FileRegistry Hedera: `0.0.10858803`
- Policy402 V1 EVM: `0xF28dD385aB3288f6c11423994968317dA4Be09B8`
- Policy402 V1 Hedera: `0.0.10862565`

## 13. Troubleshooting

### MCP Streamable HTTP

The key finding in the live runtime path is:

- MCP Streamable HTTP requires `Accept` to include `text/event-stream`
- a compliant initialize request succeeds
- the browser demo page `/mcp-test` has been proven to work end-to-end on Hedera testnet

Do not recommend changing MCP SDK versions unless an actual compatibility failure is reproduced in the current project state.

### Local Docker issues

- confirm Docker Desktop is running
- confirm `minio.license` exists at the repo root
- check `yarn infra:logs`
- verify `.env` values match the local MinIO settings

### Wallet / payment failures

- ensure the wallet is connected to Hedera testnet
- ensure the wallet account is ECDSA-capable and funded
- ensure `FACILITATOR_ACCOUNT_ID` and `FACILITATOR_PRIVATE_KEY` are valid
- ensure the app is pointing to the correct `FACILITATOR_URL`

### Contract metadata drift

- run `yarn hardhat:deploy --network hederaTestnet` if the generated `deployedContracts.ts` is stale
- confirm `Policy402` and `FileRegistry` addresses match the expected deployment metadata

## 14. Pre-submission / pre-push checks

Before pushing or opening a PR, confirm:

```bash
yarn next:check-types
yarn lint
yarn hardhat:compile
yarn hardhat:test
yarn next:build
```

Also review the git diff and ensure no secrets or generated metadata are being accidentally committed:

```powershell
git status --short --untracked-files=all
git diff --check
git diff --stat
```

Do not commit or push if the repo contains untracked `.env`, `node_modules`, `.next`, screenshots, or accidental generated artifacts.

## 15. References

- `README.md`
- `packages/hardhat/contracts/FileRegistry.sol`
- `packages/hardhat/contracts/Policy402.sol`
- `packages/nextjs/app/createpolicy/page.tsx`
- `packages/nextjs/app/revokepolicy/page.tsx`
- `packages/nextjs/app/api/mcp/route.ts`
- `packages/nextjs/services/mcp/server.ts`
- `packages/nextjs/app/mcp-test/page.tsx`
- `docker-compose.yml`

  `payTo` = the file's account id, the price in tinybars, and `extra.feePayer` from the
  facilitator.

Sanity checks:
- Unknown / malformed id → `400`.
- Unregistered id → `404`.
- Registry not deployed → `503` with a clear message.
- Facilitator down → `502`.

> Completing the payment (signing, retrying with `PAYMENT-SIGNATURE`, then receiving a
> `200` + `PAYMENT-RESPONSE` receipt and the presigned URL) is exercised end-to-end in
> Iteration 4 with the HashPack browser client and the Node agent buyer script.

## Paid MCP Demo Verification

This template includes a template-owned paid MCP tool and demo page for Hedera x402 settlement. The implementation is intentionally small and deterministic:

- Endpoint: `/api/mcp`
- Demo page: `/mcp-test`
- Tool: `get_service_info`
- Price: **0.01 HBAR** (**1,000,000 tinybars**)
- Network: **Hedera testnet**
- Asset: native **HBAR** (`0.0.0`)

### Setup

Set the required env vars in `packages/nextjs/.env`:

```dotenv
X402_NETWORK=hedera:testnet
NEXT_PUBLIC_X402_NETWORK=hedera:testnet
X402_MCP_PAY_TO=0.0.xxxxx
NEXT_PUBLIC_X402_MCP_PAY_TO=0.0.xxxxx
FACILITATOR_URL=http://localhost:4020
```

- `X402_MCP_PAY_TO` is the server-side recipient for the paid MCP demo.
- `NEXT_PUBLIC_X402_MCP_PAY_TO` must match the same account on the browser side for the allow-listed requirement.
- `X402_NETWORK` and `NEXT_PUBLIC_X402_NETWORK` must both be `hedera:testnet`.
- Use the same HashPack / WalletConnect setup as the marketplace; the demo requires a connected Hedera wallet and funded testnet HBAR.

### Start

Use the existing project commands:

```bash
yarn infra:up
yarn next:dev
```

Then open:

- `/mcp-test`
- Connect HashPack in the wallet button area
- Trigger the paid MCP tool from the page

### Expected payment flow

1. The browser MCP client requests the paid tool.
2. The resource server at `/api/mcp` responds with HTTP `402` and payment requirements.
3. The x402 client prepares a Hedera exact payment with the expected amount and pay-to account.
4. HashPack presents the native HBAR signing approval.
5. The self-hosted facilitator verifies the signed payment.
6. The facilitator settles the HBAR transfer on Hedera testnet.
7. The `get_service_info` tool executes only after successful settlement.
8. The tool result is returned to the client.

### Verification checklist

- HTTP `402` / payment negotiation occurs.
- HashPack approval appears for the explicit **0.01 HBAR** payment.
- The payment uses the expected amount (`1,000,000 tinybars`) and the configured pay-to account.
- The network is `hedera:testnet`.
- The facilitator accepts verification and settlement.
- Settlement succeeds before the tool result is returned.
- The result matches the template-owned demo tool, not an external production service.

### Troubleshooting

- **Missing / invalid `X402_MCP_PAY_TO`** — the server-side resource server requires a valid account id; the MCP service will not accept an empty or malformed value.
- **Server-side vs browser-side pay-to mismatch** — `X402_MCP_PAY_TO` and `NEXT_PUBLIC_X402_MCP_PAY_TO` must match exactly.
- **Incorrect x402 network** — ensure `X402_NETWORK` and `NEXT_PUBLIC_X402_NETWORK` both equal `hedera:testnet`.
- **Facilitator unavailable** — if `FACILITATOR_URL` is unreachable or the facilitator is not running, the MCP route will fail before settlement.
- **HashPack not connected** — the browser demo requires a connected Hedera wallet session.
- **Insufficient testnet HBAR** — the buyer needs enough native HBAR to cover the 0.01 HBAR payment and network fees.

### Security

- Keep the facilitator private key server-side only.
- Never commit real `.env` files or private keys.
- The Hardhat fallback key is local-development-only and must never be funded or reused on public Hedera networks.

## Iteration 4 — Client + UI

End-to-end upload, marketplace listing, and pay-per-download on testnet via HashPack (WalletConnect) or the Node agent script.

### Prerequisites

- Iterations 1–3 complete (registry deployed with `address` + `hederaContractId` in `deployedContracts.ts`, MinIO + facilitator running, `yarn next:dev` up).
- `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` set in `packages/nextjs/.env` (reused for HashPack).
- `NEXT_PUBLIC_X402_NETWORK=hedera:testnet` matches `X402_NETWORK`.
- HashPack mobile app on the same Hedera testnet, funded with testnet HBAR.

### A — Upload and browse (browser)

1. Connect **HashPack** in the header — approve the WalletConnect session on the native **`hedera`** namespace.
2. Upload at `/files/upload` — after MinIO PUT, HashPack prompts to sign the native `registerFile` contract execute.
3. Open `/files` — the marketplace lists entries via on-chain `getFiles` (polls every 10s). New uploads appear after registration confirms.

### B — Pay with HashPack (browser)

1. Open a **private** file at `/files/<id>`.
2. Ensure HashPack is connected (same session as upload).
3. Click **Pay … HBAR & download** — HashPack prompts to partially sign the native HBAR transfer.
4. After settlement you should get a presigned download URL and a tx receipt on the page.

### C — Pay from the Node agent

```bash
RESOURCE_URL="http://localhost:3000/api/files/<fileId>/download" \
  BUYER_ACCOUNT_ID=0.0.xxxx BUYER_PRIVATE_KEY=0x... \
  yarn x402:buy
```

Expect `200` with a presigned URL and `PAYMENT-RESPONSE` settlement metadata.

## Environment variables

Three `.env` files configure local development. Copy each from its `.env.example` before
running the stack.

### Root `.env` (docker-compose / `yarn infra:up`)

| Variable | Purpose |
| --- | --- |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | MinIO credentials (default `minioadmin`) |
| `S3_BUCKET` | Private bucket name (default `x402-files`) |
| `FACILITATOR_PORT` | Host port for the facilitator (default `4020`) |
| `X402_NETWORK` | CAIP-2 network the facilitator settles on (`hedera:testnet`) |
| `FACILITATOR_ACCOUNT_ID` | ECDSA fee-payer account (`0.0.x`) advertised in `GET /supported` |
| `FACILITATOR_PRIVATE_KEY` | ECDSA key used at `POST /settle` to co-sign, pay network fees, and submit the buyer’s partially signed transfer |
| `HEDERA_NODE_URL` | Optional custom consensus node RPC |

### `packages/nextjs/.env` (resource server + browser client)

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | WalletConnect project id (HashPack via Reown AppKit) |
| `HEDERA_RPC_URL` | RPC for on-chain `FileRegistry` reads |
| `FILE_REGISTRY_ADDRESS` | Optional EVM address override when not in `deployedContracts.ts` |
| `FILE_REGISTRY_HEDERA_CONTRACT_ID` / `NEXT_PUBLIC_FILE_REGISTRY_HEDERA_CONTRACT_ID` | Optional native contract id override (`0.0.x`) for HashPack contract executes |
| `FACILITATOR_URL` | x402 facilitator base URL (default `http://localhost:4020`) |
| `X402_NETWORK` | Server-side x402 network id |
| `NEXT_PUBLIC_X402_NETWORK` | Browser x402 client network (must match `X402_NETWORK`) |
| `X402_MCP_PAY_TO` | Server-side recipient account for the paid MCP demo |
| `NEXT_PUBLIC_X402_MCP_PAY_TO` | Browser-side allowed recipient value for the paid MCP demo (must match `X402_MCP_PAY_TO`) |
| `S3_ENDPOINT` | MinIO API URL (default `http://localhost:9000`) |
| `S3_REGION` | S3 region label (any value for MinIO) |
| `S3_BUCKET` | Bucket name (must match root `.env`) |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | MinIO credentials |
| `S3_FORCE_PATH_STYLE` | `true` for MinIO; `false` only for AWS virtual-hosted buckets |

### `facilitator/.env` (standalone facilitator, optional)

Used when running the facilitator outside Docker (`cd facilitator && npm start`). Same
`FACILITATOR_ACCOUNT_ID`, `FACILITATOR_PRIVATE_KEY`, and `X402_NETWORK` as the root `.env`.

### Optional facilitator fallback

The default is the **self-hosted** facilitator from `docker-compose.yml`. To use an external
hosted facilitator instead (e.g. Blocky402 testnet), set `FACILITATOR_URL` in
`packages/nextjs/.env` — this is not required for local development.

---

## Testnet caveats

- **ECDSA keys only** — x402 on Hedera requires ECDSA accounts. Create testnet accounts via the
  [Hedera Portal](https://portal.hedera.com/) and fund them with HBAR.
- **Buyer needs HBAR** — every private download is a fresh native HBAR transfer. No token
  association is required for HBAR (`0.0.0`).
- **Facilitator fee payer** — HashPack cannot complete x402 settlement alone. The facilitator’s
  ECDSA account co-signs each transfer, pays Hedera network fees from its HBAR balance, and
  broadcasts the transaction. Keep `FACILITATOR_PRIVATE_KEY` server-side only.
- **Testnet settlement** — MinIO and the facilitator run locally, but Hedera payments hit
  **testnet** (or mainnet if configured). The local Hedera fork is not used for x402.
- **Native HashPack signing** — registry writes use `hedera_signAndExecuteTransaction`; x402
  payments use `hedera_signTransaction` (partial sign). Both use the `hedera` WalletConnect
  namespace — not wagmi / `eip155`.
- **Marketplace listing** — `/files` reads `getFileCount` + `getFiles`, not `eth_getLogs`.
  Hedera JSON-RPC limits log queries to a **7-day** window (timestamp-based “blocks”).
- **Docker required** — `yarn infra:up` starts MinIO and the facilitator containers.
- **Node.js** — Node 20 LTS by default; optional Node 22 for `yarn next:dev` / `yarn next:build` only
  (see [README § Node.js version](README.md#nodejs-version)). A harmless `NodeVersionSupportWarning`
  from `@aws-sdk/client-s3` on Node 20 can be ignored.
- **Pin `@x402/hedera`** — the package is young; expect API churn across releases.
- **No on-chain privacy** — transfer amounts, accounts, and settlement txs are public on Hedera.

---

## Iteration 5 — Packaging (`create-scaffold-hbar`)

This template is published as git branch **`templates/x402-pay-per-use`** on the scaffold-hbar
repo. The CLI downloads that branch via giget — there is no embedded copy in the CLI repo.

### 5.1 What ships in the template

| Piece | Location |
| --- | --- |
| Manifest (consumed then deleted by CLI) | `template.json` |
| Contracts (Hardhat only) | `packages/hardhat/` (`FileRegistry.sol`) |
| Resource server + UI | `packages/nextjs/` |
| Self-hosted facilitator | `facilitator/` |
| Local infra | `docker-compose.yml`, root `.env.example` |
| Docs | `README.md`, `RUNBOOK.md` |

Foundry is **not** included. `template.json` locks `solidityFramework` to `hardhat` only.

### 5.2 Publish / update the template branch

From a branch that contains the finished template (e.g. `feat/add-x402-resource-server`):

```bash
# Ensure template.json, package.json (no foundry workspace), and docs are committed.
git push origin HEAD:templates/x402-pay-per-use
```

Or merge into `templates/x402-pay-per-use` and push. The branch name must be exactly
`templates/x402-pay-per-use` so `npx create-scaffold-hbar@latest --template x402-pay-per-use`
resolves to `hedera-dev/scaffold-hbar#templates/x402-pay-per-use`.

### 5.3 Scaffold a fresh project

```bash
npx create-scaffold-hbar@latest --template x402-pay-per-use
```

Interactive mode lists the template automatically once the branch exists on GitHub (GitHub API
`templates/*` refs). The CLI prints custom **outro steps** from `template.json` (env copy,
`yarn infra:up`, Hardhat deploy, `yarn next:dev`).

### 5.4 Optional CLI polish (`create-scaffold-hbar` repo)

Not required for discovery. For a friendlier prompt label and offline fallback, add to
`src/utils/consts.ts` in the `create-hbar` package:

- `TEMPLATE_LABEL_OVERRIDES["x402-pay-per-use"] = "x402 Pay-Per-Use"`
- `TEMPLATE_CAPABILITIES_FALLBACK["x402-pay-per-use"]` with `solidityFramework: ["hardhat"]`

### 5.5 Post-scaffold smoke test

After scaffolding into a clean directory:

1. `yarn install`
2. Copy `.env` files and set facilitator + WalletConnect credentials
3. `yarn infra:up` → `curl localhost:4020/health`
4. `yarn hardhat:deploy --network hederaTestnet`
5. `yarn next:dev` → upload a file, pay with HashPack on a private listing
