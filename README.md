# MPP Payment-Gated Proxy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/mpp-proxy)

A Cloudflare Worker that acts as a transparent reverse proxy with payment-gated access using the [Machine Payments Protocol](https://mpp.dev/overview) and stateless cookie-based authentication.

## Overview

This proxy sits in front of any origin and:

1. Proxies unprotected traffic straight through.
2. Requires MPP payment on matching protected paths.
3. Verifies `Authorization: Payment` credentials with the `mppx` SDK.
4. Returns MPP-standard `WWW-Authenticate: Payment` and `Payment-Receipt` headers.
5. Issues a 1-hour JWT cookie after a successful payment to avoid repaying on every request.

The repo ships with production defaults: Tempo production, USDC at `0x20c000000000000000000000b9537d11c60e8b50`, and the dead address `0x000000000000000000000000000000000000dEaD` as `PAY_TO` until you replace it.

## Try It Out

The **Deploy to Cloudflare** button above creates a Worker for you. Once deployed, you can test the payment flow with an AI agent or the `tempo` CLI.

### 1. Verify the deploy

```bash
curl https://YOUR-WORKER.workers.dev/__mpp/health
```

### 2. Hit the protected route

```bash
curl -i https://YOUR-WORKER.workers.dev/__mpp/protected
```

You should get `402 Payment Required` with a `WWW-Authenticate: Payment` header. That confirms the paywall is active.

### 3. Log in to Tempo

```bash
tempo wallet login
```

### 4. Make a paid request

Tell your agent to run:

```bash
tempo request -X GET https://YOUR-WORKER.workers.dev/__mpp/protected
```

Or use `mppx` directly:

```bash
npx mppx https://YOUR-WORKER.workers.dev/__mpp/protected
```

The client handles the `402` automatically — it pays and returns the protected content with a `Payment-Receipt` header.

## Built-In Endpoints

- `/__mpp/health` - public health check
- `/__mpp/config` - sanitized runtime config
- `/__mpp/protected` - built-in paid route for testing

## Quick Start (Local Development)

```bash
npm install
echo "JWT_SECRET=$(openssl rand -hex 32)" > .dev.vars
echo "MPP_SECRET_KEY=$(openssl rand -hex 32)" >> .dev.vars
npm run dev
```

Then hit `http://localhost:8787/__mpp/health` or `http://localhost:8787/__mpp/protected`.

For local testnet development, set `TEMPO_TESTNET` to `true` and `PAYMENT_CURRENCY` to `0x20c0000000000000000000000000000000000000` in `wrangler.jsonc`. See [TUTORIAL.md](TUTORIAL.md) for a full local walkthrough.

If you want the optional landing page at `/`, uncomment the `assets` block in `wrangler.jsonc`.

## Configuration

The proxy is configured in `wrangler.jsonc`. The checked-in defaults keep routes disabled and use production-safe payment values until you swap in your own domain, wallet, and token.

### Required vars

| Variable             | Description                                |
| -------------------- | ------------------------------------------ |
| `PAY_TO`             | Recipient wallet address                   |
| `PAYMENT_CURRENCY`   | Token address clients pay with             |
| `TEMPO_TESTNET`      | `false` for production, `true` for testnet |
| `PROTECTED_PATTERNS` | Paid paths and their amounts               |

### Required secrets

| Secret           | Description                                     |
| ---------------- | ----------------------------------------------- |
| `JWT_SECRET`     | Signs the auth cookie                           |
| `MPP_SECRET_KEY` | Signs MPP challenges for stateless verification |

### Optional secrets

| Secret          | Description                                              |
| --------------- | -------------------------------------------------------- |
| `TEMPO_RPC_URL` | Authenticated Tempo RPC URL for server-side verification |

Set secrets for production with:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put MPP_SECRET_KEY
```

If your Tempo RPC requires authentication, also set `TEMPO_RPC_URL`.

Use `TEMPO_RPC_URL` when Tempo RPC access requires authentication, for example:

```text
https://user:pass@rpc.mainnet.tempo.xyz/
```

Without this override, `mppx` falls back to the default Tempo RPC URLs for server-side verification.

### Protected path config

```jsonc
"PROTECTED_PATTERNS": [
  {
    "pattern": "/premium/*",
    "amount": "0.01",
    "description": "Access to premium content for 1 hour"
  }
]
```

Bot Management filtering is still supported with `bot_score_threshold` and `except_detection_ids`.

The built-in paid test route at `/__mpp/protected` always exists, even if you change or remove `PROTECTED_PATTERNS`.

## How Payment Works

1. Client requests a protected route.
2. Proxy returns `402 Payment Required` with `WWW-Authenticate: Payment`.
3. Client retries with `Authorization: Payment`.
4. Proxy verifies the credential with `mppx`.
5. Proxy forwards to the origin and adds `Payment-Receipt`.
6. Proxy also issues an `auth_token` cookie valid for 1 hour.

That means MPP-native clients get standards-compliant receipts, while browsers and agents can reuse the cookie for repeated access during the valid period.

## Proxy Modes

### DNS-based origin

Leave `ORIGIN_URL` unset and route traffic to an origin already defined in Cloudflare DNS.

### External origin

Set:

```jsonc
"ORIGIN_URL": "https://my-backend.example.com"
```

### Service binding

If the origin is another Worker in your account:

```jsonc
"services": [
  { "binding": "ORIGIN_SERVICE", "service": "my-origin-worker" }
]
```

## Local Testing

### Health endpoint

```bash
curl http://localhost:8787/__mpp/health
```

### Built-in protected route

```bash
curl -i http://localhost:8787/__mpp/protected
```

You should get `402 Payment Required` and a `WWW-Authenticate: Payment` header.

### CLI payment test

```bash
npx mppx account create
npx mppx http://localhost:8787/__mpp/protected
```

### Scripted client test

```bash
PRIVATE_KEY=0x... npm run test:client
```

See `TESTING.md` for details.

## Project Structure

```text
src/index.ts              Main proxy entrypoint
src/auth.ts               Cookie + MPP payment middleware
src/jwt.ts                JWT utilities
src/bot-management/       Optional Bot Management filtering
public/index.html         Optional landing page
test-client.ts            End-to-end MPP client test
wrangler.jsonc            Worker configuration
```

## Notes

- This project uses the Tempo payment method through `mppx`.
- `Payment-Receipt` is returned on successful paid requests.
- Cookies are `HttpOnly`, `Secure`, and `SameSite=Strict`.
- Uncomment `assets` in `wrangler.jsonc` only if you want the optional landing page served at `/`.
