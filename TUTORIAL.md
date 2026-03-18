# Local Testing Tutorial

This tutorial shows exactly how to test the local MPP proxy running at `http://localhost:8787`.

It covers:

1. checking that the server is alive
2. confirming the route is payment-gated
3. creating a local MPP payer account
4. funding the payer account
5. making a paid request
6. testing the cookie shortcut after payment

## Before you start

You need two terminal windows.

### Set up local secrets

Generate `.dev.vars` with the required secrets:

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" > .dev.vars
echo "MPP_SECRET_KEY=$(openssl rand -hex 32)" >> .dev.vars
```

This creates `.dev.vars` with real random values for `JWT_SECRET` and `MPP_SECRET_KEY`. Without these, protected routes will fail with `500`.

### Terminal 1: keep the Worker running

Start the Worker in the project directory:

```bash
npm run dev
```

Leave this terminal open for the rest of the tutorial.

### Terminal 2: run the test commands

Open a second terminal and go to the same project directory.

```bash
git clone https://github.com/cloudflare/mpp-proxy.git
cd mpp-proxy
```

All remaining commands in this tutorial should be run in Terminal 2.

## Step 1: Confirm the server is up

Run:

```bash
curl http://localhost:8787/__mpp/health
```

You should get JSON that includes these fields:

```json
{
  "status": "ok",
  "proxy": "mpp-proxy",
  "paymentMethod": "tempo",
  "message": "This endpoint is always public",
  "timestamp": 1234567890
}
```

If this fails, stop here and fix the local server first.

## Step 2: Confirm the route is protected

Run:

```bash
curl -i http://localhost:8787/__mpp/protected
```

You should see all of these:

- HTTP status `402 Payment Required`
- a `WWW-Authenticate: Payment` header
- a problem-details JSON body instead of the premium content

This proves the MPP paywall is active.

## Step 3: Create a local payer account

Create a named `mppx` account:

```bash
npx mppx account create -a localdemo
```

Then set it as the default account:

```bash
npx mppx account default -a localdemo
```

Then print the account address:

```bash
npx mppx account view -a localdemo
```

Copy the wallet address that is printed. You may need it in Step 4B to fund it manually.

## Step 4: Fund the payer account

You have two ways to do this.

### Step 4A: Try the built-in fund command first

Run:

```bash
npx mppx account fund -a localdemo
```

What this does:

- it asks the `mppx` CLI to fund your `localdemo` account on Tempo testnet
- if successful, the CLI account will receive testnet funds you can use for the local payment

After that, check the payer address again:

```bash
npx mppx account view -a localdemo
```

If Step 4A succeeds, continue to Step 5.

If Step 4A fails, use Step 4B.

### Step 4B: Fund it from your Tempo wallet manually

If the automatic fund command does not work, send funds from your existing wallet to the payer account.

#### 4B.1 Get the `localdemo` address again

Run:

```bash
npx mppx account view -a localdemo
```

Copy the full address.

#### 4B.2 Open your Tempo wallet

Open:

```text
https://wallet.tempo.xyz/
```

#### 4B.3 Send funds to the `localdemo` address

In the Tempo wallet UI:

1. click the send/transfer button
2. paste the `localdemo` wallet address as the recipient
3. choose the same token the demo is charging in
4. send a small amount

This repo currently uses this token by default in `wrangler.jsonc`:

```text
0x20c0000000000000000000000000000000000000
```

That is the default Tempo testnet PathUSD token used by the demo.

You do not need to send much. The built-in test route charges only `0.01`.

To avoid running out during retries, sending `0.10` or `0.25` is a comfortable amount.

#### 4B.4 Wait for the transfer to complete

Wait until the wallet UI shows the transfer as completed.

## Step 5: Make the paid request

Run:

```bash
npx mppx http://localhost:8787/__mpp/protected -a localdemo -i
```

What should happen:

1. `mppx` requests the route
2. the server responds with `402 Payment Required`
3. `mppx` reads the `WWW-Authenticate: Payment` challenge
4. `mppx` signs and submits the payment automatically
5. the server verifies the payment and returns the protected response

You want to see:

- final HTTP status `200`
- the protected JSON response body
- a `Payment-Receipt` header
- a `Set-Cookie` header containing `auth_token`

## Step 6: Test the cookie shortcut

After Step 5, copy the `auth_token` value from the `Set-Cookie` header.

Then run this command, replacing `<token>` with the real value:

```bash
curl http://localhost:8787/__mpp/protected -H "Cookie: auth_token=<token>"
```

You should now get the protected response without paying again.

Example success response:

```json
{
  "message": "Premium content accessed through MPP!",
  "timestamp": 1234567890,
  "note": "This endpoint always requires a Payment credential or a valid authentication cookie."
}
```

That proves the proxy's 1-hour JWT session is working.

## Step 7: Optional - verify the runtime config

Run:

```bash
curl http://localhost:8787/__mpp/config
```

Check that it shows:

- `paymentMethod` = `tempo`
- `tempoTestnet` = `true`
- the configured protected patterns

## Optional: set up a real receiver account

The main tutorial uses the default dead address (`0x...dEaD`) as the receiver. Payments sent there are unrecoverable but the full flow still works for testing.

If you want payments to go to a real account, you have two options.

### Option A: Create a local receiver account

Create a second `mppx` account to act as the receiver:

```bash
npx mppx account create -a receiver_wallet
npx mppx account view -a receiver_wallet
```

Copy the `Address` value.

Open `wrangler.jsonc` and replace the `PAY_TO` value with that address:

```jsonc
"PAY_TO": "0x1234567890abcdef1234567890abcdef12345678",
```

Save the file and restart the Worker in Terminal 1:

```bash
npm run dev
```

Verify the receiver changed:

```bash
curl http://localhost:8787/__mpp/config
```

The `payTo` field should no longer end in `dEaD`.

### Option B: Use your personal wallet as the receiver

1. open `wrangler.jsonc`
2. find `vars.PAY_TO`
3. replace the receiver address with your public wallet address
4. save the file
5. restart `npm run dev`

Do not use a spend key or private key in `wrangler.jsonc`.

## Quick copy-paste version

If your server is already running in another terminal, these are the core commands:

```bash
cd path/to/mpp-proxy
echo "JWT_SECRET=$(openssl rand -hex 32)" > .dev.vars
echo "MPP_SECRET_KEY=$(openssl rand -hex 32)" >> .dev.vars
curl http://localhost:8787/__mpp/health
curl -i http://localhost:8787/__mpp/protected
npx mppx account create -a localdemo
npx mppx account default -a localdemo
npx mppx account view -a localdemo
npx mppx account fund -a localdemo
npx mppx http://localhost:8787/__mpp/protected -a localdemo -i
```

If `npx mppx account fund -a localdemo` fails, manually send funds from `https://wallet.tempo.xyz/` to the address printed by `npx mppx account view -a localdemo`, then rerun the final `npx mppx ...` command.

## What success looks like

At the end of this tutorial, all of these should be true:

- `curl http://localhost:8787/__mpp/health` returns `200`
- `curl -i http://localhost:8787/__mpp/protected` returns `402`
- `npx mppx http://localhost:8787/__mpp/protected -a localdemo -i` returns `200`
- the successful response includes `Payment-Receipt`
- the `auth_token` cookie works on a follow-up `curl`

If any step fails, save the exact command output and use that output for debugging.
