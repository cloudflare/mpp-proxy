# mpp-proxy Setup Guide for AI Agents

Context for AI coding agents helping users set up this MPP payment-gated proxy template.

## What is mpp-proxy?

A Cloudflare Worker that adds payment gating to any origin using the Machine Payments Protocol (MPP).

- Protected routes return `402 Payment Required` with `WWW-Authenticate: Payment`
- Clients retry with `Authorization: Payment`
- Successful responses include `Payment-Receipt`
- The proxy also issues a JWT cookie valid for 1 hour so browsers and agents can reuse access without paying again on every request

**With Bot Management Filtering:** Requires Bot Management for Enterprise to enable bot filtering. When enabled, humans can pass through free while likely automated traffic must pay. This is optional and enhances the base functionality.

This template is currently wired to the Tempo payment method via `mppx`.

---

## Interactive Setup Flow

When a user asks for help setting up the proxy, follow this discovery process.

### Step 1: Verify Cloudflare Authentication

```bash
npx wrangler whoami
```

If not logged in, guide them to run `npx wrangler login`.

If they have multiple accounts, note them for Step 2.

---

### Step 2: Select Domain

Ask: **"Which domain do you want to add payment gating to?"**

If the user has multiple Cloudflare accounts, also ask: **"Which account is this domain on?"**

Save the domain. It scopes the rest of setup.

---

### Step 3: Check for Bot Management (Optional Enhancement)

Ask: **"Do you have Bot Management enabled on `{domain}`?"**

Explain why:

> With Bot Management enabled, the proxy can implement a default-closed model for bots: likely human traffic passes free, while likely automated traffic must pay. You can also allow specific bots like Googlebot or verified AI assistants through for free.
>
> Without Bot Management, the proxy still works perfectly. All traffic to protected routes must pay.

| Answer  | Effect                                     |
| ------- | ------------------------------------------ |
| **Yes** | Enable Bot Management prompts in Step 4    |
| **No**  | Skip threshold/exception prompts in Step 4 |

---

### Step 4: Configure Protected Paths (Iterative)

Ask: **"What path on `{domain}` do you want to charge for?"**

If the user provides multiple paths at once, queue them and configure each in sequence.

For each path, ask:

#### 4.1 Amount

Ask: **"What amount should `{path}` cost?"**

Format: `0.01`, `0.10`, `1.00`, etc.

Important: this template stores the value as `amount`, not `price`.

#### 4.2 Description

Ask: **"What description should users see for `{path}`?"**

Example: `Access to premium content for 1 hour`

#### 4.3 If Bot Management is enabled

Ask: **"What bot score threshold should `{path}` use?"**

Offer exactly these three options:

| Option               | Threshold | Meaning                                                        |
| -------------------- | --------- | -------------------------------------------------------------- |
| **1**                | 1         | Very strict - only verified humans pass free                   |
| **2**                | 2         | Strict - only clear human traffic passes free                  |
| **30 (Recommended)** | 30        | Balanced - likely automated traffic must pay, humans pass free |

Then ask: **"Any bots that should get FREE access to `{path}`?"**

Offer these presets:

| Preset                    | Bots Included                                                            | Use When                     |
| ------------------------- | ------------------------------------------------------------------------ | ---------------------------- |
| **Googlebot + BingBot**   | Googlebot, BingBot                                                       | Allow major crawlers         |
| **Above + AI assistants** | Above + ChatGPT-User, Claude-User, Perplexity-User, Meta-ExternalFetcher | Allow AI assistant citations |
| **None**                  | (empty)                                                                  | All bots must pay            |

If the user selects a preset or specific bot names, resolve them using the Bot Registry below and write the resulting IDs to `except_detection_ids`.

Example:

```jsonc
"except_detection_ids": [
  120623194, // Googlebot
  117479730  // BingBot
]
```

#### 4.4 More paths

Ask: **"Any more paths on `{domain}` to protect?"**

- If yes, repeat Step 4
- If no, continue

---

### Step 5: Wallet and Tempo Configuration

Ask these together:

1. **"What wallet address should receive payments (`PAY_TO`)?"**
2. **"Use Tempo testnet or production?"**

Map the answer to config like this:

| User Choice | `TEMPO_TESTNET` |
| ----------- | --------------- |
| Testnet     | `true`          |
| Production  | `false`         |

Then ask:

3. **"Which token address should clients pay in (`PAYMENT_CURRENCY`)?"**

Recommended default for demos:

```text
0x20c000000000000000000000b9537d11c60e8b50
```

That is the default PathUSD address used by this template for Tempo testnet demos.

If the user does not have a wallet address yet, they can use the default dead address for smoke testing:

```text
0x000000000000000000000000000000000000dEaD
```

---

## Deployment Phase

Now that config is complete, discover infrastructure and deploy.

### Step 6: Discover Existing Workers and Routes

```bash
npx wrangler deployments list
npx wrangler routes list --zone {domain}
```

This reveals:

- what Workers are already deployed
- whether another Worker already owns routes on the domain

Determine deployment mode:

| Situation                                    | Recommended Mode                             |
| -------------------------------------------- | -------------------------------------------- |
| Origin is a traditional server               | Standard Proxy Mode                          |
| Origin is an external API or service         | External Origin Mode                         |
| Origin is another Worker in the same account | Service Binding Mode                         |
| Existing Worker already owns `domain/*`      | External Origin Mode or Service Binding Mode |

---

### Step 7: Generate `wrangler.jsonc`

Write the complete configuration for this MPP template.

Basic example:

```jsonc
{
  "routes": [
    { "pattern": "example.com/premium/*", "zone_name": "example.com" },
  ],
  "vars": {
    "PAY_TO": "0x000000000000000000000000000000000000dEaD",
    "TEMPO_TESTNET": true,
    "PAYMENT_CURRENCY": "0x20c000000000000000000000b9537d11c60e8b50",
    "PROTECTED_PATTERNS": [
      {
        "pattern": "/premium/*",
        "amount": "0.01",
        "description": "Access to premium content for 1 hour",
      },
    ],
  },
}
```

With Bot Management Filtering:

```jsonc
{
  "routes": [
    { "pattern": "example.com/content/*", "zone_name": "example.com" },
  ],
  "vars": {
    "PAY_TO": "0x000000000000000000000000000000000000dEaD",
    "TEMPO_TESTNET": true,
    "PAYMENT_CURRENCY": "0x20c000000000000000000000b9537d11c60e8b50",
    "PROTECTED_PATTERNS": [
      {
        "pattern": "/content/*",
        "amount": "0.25",
        "description": "Content access for 1 hour",
        "bot_score_threshold": 30,
        "except_detection_ids": [120623194, 117479730],
      },
    ],
  },
}
```

Notes:

- Use `amount`, not `price`
- Do not configure `FACILITATOR_URL` or `NETWORK`; those were x402-era concepts and are not used by this repo anymore
- This repo uses Tempo through `mppx`

---

### Step 8: Set Secrets

This repo requires two secrets.

Set the JWT secret:

```bash
openssl rand -hex 32 | npx wrangler secret put JWT_SECRET
```

Set the MPP challenge secret:

```bash
openssl rand -hex 32 | npx wrangler secret put MPP_SECRET_KEY
```

If Tempo RPC access requires authentication, also set an authenticated RPC URL so server-side verification and transaction broadcast do not fall back to `https://rpc.tempo.xyz/`:

```bash
printf '%s' 'https://user:pass@rpc.mainnet.tempo.xyz/' | npx wrangler secret put TEMPO_RPC_URL
```

---

### Step 9: Deploy

```bash
npm run deploy
```

---

### Step 10: Verify

```bash
curl https://{domain}/__mpp/health
# Should return: {"status":"ok",...}

curl https://{domain}/__mpp/config
# Should show token, wallet suffix, and protected patterns
```

For a real payment test, use the MPP CLI:

```bash
npx mppx https://{domain}/__mpp/protected
```

---

## Deployment Modes

### Standard Proxy Mode (DNS-based)

- The proxy owns the route, e.g. `api.example.com/*`
- Protected paths require MPP payment; everything else passes through
- Use when the origin is a traditional server

```text
User -> mpp-proxy -> Origin Server
```

### External Origin Mode

- The proxy owns the route and rewrites requests to `ORIGIN_URL`
- Use when the origin is another public service or Worker you do not want to modify

```jsonc
"ORIGIN_URL": "https://my-existing-service.example.com"
```

### Service Binding Mode

- The proxy calls the origin Worker through `ORIGIN_SERVICE`
- Use when the origin is another Worker in the same account and you want the best performance

```jsonc
"services": [{ "binding": "ORIGIN_SERVICE", "service": "my-origin-worker" }]
```

---

## Bot Management Filtering Reference

Requires Bot Management for Enterprise.

When enabled:

- humans can pass for free
- excepted bots can pass for free
- everyone else must pay

### Threshold Reference

| Threshold | Meaning                                                | Use Case             |
| --------- | ------------------------------------------------------ | -------------------- |
| **1**     | Very strict - only verified humans pass free           | Maximum monetization |
| **2**     | Strict - only clear human traffic passes free          | High-value APIs      |
| **30**    | Balanced - likely automated must pay, humans pass free | Recommended default  |

### Bot Registry Reference

Use this registry when converting human-readable bot names to detection IDs.

#### Google

| Bot Name              | Detection ID | Notes              |
| --------------------- | ------------ | ------------------ |
| Googlebot             | 120623194    | Google Search      |
| Google-CloudVertexBot | 133730073    | Google AI training |

#### Microsoft

| Bot Name | Detection ID | Notes          |
| -------- | ------------ | -------------- |
| BingBot  | 117479730    | Microsoft Bing |

#### OpenAI

| Bot Name      | Detection ID | Notes                  |
| ------------- | ------------ | ---------------------- |
| GPTBot        | 123815556    | OpenAI training        |
| ChatGPT-User  | 132995013    | ChatGPT browsing mode  |
| ChatGPT agent | 129220581    | ChatGPT agents/plugins |
| OAI-SearchBot | 126255384    | OpenAI Search          |

#### Anthropic

| Bot Name         | Detection ID |
| ---------------- | ------------ |
| ClaudeBot        | 33563859     |
| Claude-SearchBot | 33564301     |
| Claude-User      | 33564303     |

#### Perplexity

| Bot Name        | Detection ID |
| --------------- | ------------ |
| PerplexityBot   | 33563889     |
| Perplexity-User | 33564371     |

#### Meta

| Bot Name             | Detection ID |
| -------------------- | ------------ |
| Meta-ExternalAgent   | 124581738    |
| Meta-ExternalFetcher | 132272919    |
| FacebookBot          | 33563972     |

---

## Configuration Reference

### Required vars

| Variable             | Description                      |
| -------------------- | -------------------------------- |
| `PAY_TO`             | Wallet address receiving payment |
| `TEMPO_TESTNET`      | Tempo testnet toggle             |
| `PAYMENT_CURRENCY`   | Token address clients pay in     |
| `PROTECTED_PATTERNS` | Array of protected path configs  |

### Required secrets

| Variable         | Description                          |
| ---------------- | ------------------------------------ |
| `JWT_SECRET`     | Secret for auth cookies              |
| `MPP_SECRET_KEY` | Secret for signing MPP challenges    |
| `TEMPO_RPC_URL`  | Optional authenticated Tempo RPC URL |

### Protected pattern schema

```ts
{
  pattern: string
  amount: string
  description: string
  bot_score_threshold?: number
  except_detection_ids?: number[]
}
```

### Optional vars

| Variable         | Description                       |
| ---------------- | --------------------------------- |
| `ORIGIN_URL`     | External origin URL               |
| `ORIGIN_SERVICE` | Service binding to another Worker |

### Debug endpoints

- `/__mpp/health` - health check
- `/__mpp/config` - sanitized runtime config
- `/__mpp/protected` - built-in paid route for testing

---

## Common Issues

### Another Worker already owns the route

Wrangler may fail with a route conflict.

Fix:

1. Identify the existing route owner with `npx wrangler routes list --zone <domain>`
2. Remove the route from the old Worker
3. Redeploy this proxy

Alternative: keep the old Worker live and point `ORIGIN_URL` at it.

### `JWT_SECRET` or `MPP_SECRET_KEY` not set

Protected routes will fail with `500` until both secrets are created.

### `402` works but content fails

The payment layer is fine; the origin is failing. Test the origin directly.

### Homepage shows the built-in demo instead of the origin

This repo ships with `public/index.html` for demos. If you want the root path to proxy to your origin, comment out or remove the `assets` block in `wrangler.jsonc`.

### Bot Management Filtering warning about `cf.botManagement`

This means Bot Management data is not available.

Causes:

- Bot Management for Enterprise is not enabled
- the request is from local development, where bot signals are unavailable

### Human traffic still gets `402`

Check that:

1. `bot_score_threshold` is set
2. Bot Management is enabled on the zone
3. The score is actually above the threshold

Use `npx wrangler tail` to inspect request metadata after deployment.

---

## Testing Locally

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" > .dev.vars
echo "MPP_SECRET_KEY=$(openssl rand -hex 32)" >> .dev.vars
npm run dev

curl http://localhost:8787/__mpp/health
curl http://localhost:8787/__mpp/protected
```

Then try an MPP client flow:

```bash
npx mppx http://localhost:8787/__mpp/protected
```

---

## Pre-Deploy Checklist

Before running `npm run deploy`, verify:

- `routes` matches the correct domain and path
- `PAY_TO` is set correctly
- `PAYMENT_CURRENCY` is set correctly
- `TEMPO_TESTNET` matches testnet vs production intent
- `PROTECTED_PATTERNS` uses `amount`, not `price`
- `JWT_SECRET` exists
- `MPP_SECRET_KEY` exists
- `TEMPO_RPC_URL` is set if your Tempo RPC requires authentication
- `assets` is commented out if you want full proxy behavior at `/`
- `ORIGIN_SERVICE` or `ORIGIN_URL` is configured if DNS-based origin routing is not correct

If using Bot Management Filtering:

- Bot Management is enabled
- `bot_score_threshold` is set on relevant paths
- `except_detection_ids` are resolved correctly

---

## Additional Resources

- [MPP overview](https://mpp.dev/overview)
- [MPP TypeScript SDK](https://mpp.dev/sdk/typescript)
- [MPP quickstart](https://mpp.dev/quickstart)
- [Cloudflare Workers Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [Cloudflare Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
