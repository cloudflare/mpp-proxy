# Testing Guide

This project supports both standards-level MPP testing and the JWT cookie shortcut used by the proxy.

## Prerequisites

1. A Tempo test wallet private key
2. Test tokens in that wallet
3. The Worker running locally:

```bash
npm run dev
```

## Automated test client

```bash
PRIVATE_KEY=0x... npm run test:client
```

The script will:

1. Request `/__mpp/protected` and confirm a `402 Payment Required`
2. Inspect the `WWW-Authenticate: Payment` challenge
3. Use `mppx` to complete the payment automatically
4. Verify a `Payment-Receipt` is returned
5. Reuse the issued `auth_token` cookie without paying again

## Manual checks

### Public endpoint

```bash
curl http://localhost:8787/__mpp/health
```

### Paid endpoint without payment

```bash
curl -i http://localhost:8787/__mpp/protected
```

You should see:

- `402 Payment Required`
- `WWW-Authenticate: Payment ...`
- `Cache-Control: no-store`

### Pay with the MPP CLI

```bash
npx mppx account create
npx mppx http://localhost:8787/__mpp/protected
```

### Check the cookie path

After a successful paid request, copy the `auth_token` cookie and retry:

```bash
curl http://localhost:8787/__mpp/protected \
  -H "Cookie: auth_token=<token>"
```

## Environment variables for `test-client.ts`

- `PRIVATE_KEY` - required Tempo wallet private key
- `SERVER_URL` - optional, defaults to `http://localhost:8787`

## Notes

- The built-in script uses `mppx/client` with the Tempo method.
- The proxy still uses cookies after payment so repeat browser requests stay cheap.
- Never test with a wallet that holds real funds.
