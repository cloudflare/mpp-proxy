# Contributing

Thanks for helping improve `mpp-proxy`.

## Development

```bash
npm install
echo "JWT_SECRET=$(openssl rand -hex 32)" > .dev.vars
echo "MPP_SECRET_KEY=$(openssl rand -hex 32)" >> .dev.vars
npm run dev
```

## Before opening a pull request

Run the checks that exist in this repo:

```bash
npm run typecheck
npm run lint
```

If you change runtime bindings or checked-in defaults, regenerate `worker-configuration.d.ts` with:

```bash
npm run cf-typegen
```

## Pull requests

- keep changes focused
- update docs when defaults or behavior change
- include validation notes for local testing, especially around the MPP payment flow
