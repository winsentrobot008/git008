# Deploying the MAOTANG dashboard to `maotang.008ai.online`

Release channel for `frontend/` (the MAOTANG protocol dashboard). It is deliberately separate from
`products/008ai-landing/scripts/vercel-api-deploy.mjs`, which owns `008ai.online` /
`www.008ai.online`; this pipeline never touches those aliases.

## What it does

`frontend/scripts/vercel-api-deploy.mjs`

1. Creates (or links) the Vercel project `maotang-frontend`, framework `nextjs`,
   `rootDirectory=frontend`.
2. Upserts the five public production variables on that project.
3. Uploads **two source trees** in one deployment, then builds:
   - `frontend/` -> `frontend/`
   - `sdk/` -> `sdk/` (sibling package; `frontend/package.json` depends on `@maotang/sdk`
     via `file:../sdk`, and `sdk/dist` is an untracked build artifact)
   - install: `npm --prefix ../sdk install && npm --prefix ../sdk run build && npm install`
4. Polls until `readyState === READY`.
5. Attaches `maotang.008ai.online` to the project and reports verification/CNAME status.

## Usage

```powershell
cd D:\git008\frontend
node scripts/vercel-api-deploy.mjs --dry-run   # path mapping only, no network
$env:VERCEL_TOKEN = "..."                       # never written to the repo
node scripts/vercel-api-deploy.mjs
```

Injected production variables (also mirrored in `frontend/.env.production`, which is skipped from
the upload so the Vercel project values win):

| Key | Value |
| --- | --- |
| `NEXT_PUBLIC_CHAIN_ID` | `31337` |
| `NEXT_PUBLIC_MAOTANG_RPC_URL` | `https://rpc.008ai.online` |
| `NEXT_PUBLIC_OPERATOR_ADDRESS` | `0x6aEceB240C902Cc0A52AB7F0eb5bf6B1030077ea` |
| `NEXT_PUBLIC_DEVELOPER_ADDRESS` | `0x6aEceB240C902Cc0A52AB7F0eb5bf6B1030077ea` |
| `NEXT_PUBLIC_BTC_REVENUE_ADDRESS` | `1CqDscj8LCx9xXJcxGkSMnwwKVFXbzutDe` |

## Prerequisites

- **Token scope.** `VERCEL_TOKEN` must be able to create projects. A token scoped to the
  `008ai-landing` project fails at step 1 with `ERR_PROJECT_CREATE_FORBIDDEN` (HTTP 403
  `forbidden: You don't have permission to create the project`). Fix by granting the token
  project-create scope, or by creating the empty project `maotang-frontend` once in the Vercel
  dashboard and re-running.
- **DNS.** `maotang.008ai.online` is currently a `NXDOMAIN`; the zone (`008ai.online`) is
  Cloudflare-proxied, so Vercel cannot create the record itself. After the deployment is `READY`,
  add a DNS record in the zone that manages `008ai.online`:
  `CNAME maotang -> cname.vercel-dns.com` (proxied off), then wait for Vercel verification.
- `rpc.008ai.online` is live: the `008-video` Cloudflare tunnel maps it to the local EVM node on
  `http://127.0.0.1:8545`. The deployed bundle inlines the configured value, so the endpoint has to
  be up for the dashboard to work — and it is public, so read "RPC exposure" below before relying on it.

## RPC exposure (read before every production run)

`https://rpc.008ai.online` is a **public, unauthenticated** endpoint: the tunnel forwards whatever
sits behind it to anyone on the internet, and the Alpha chain behind it is an Anvil development node
that exposes, by design:

- ten unlocked accounts pre-funded with 10 000 ETH each (`eth_accounts`, `eth_sendTransaction`), so
  any visitor can move that balance or deploy to the chain;
- the `anvil_*` admin namespace (`anvil_setBalance`, `anvil_reset`, `anvil_impersonateAccount`, ...),
  which can rewrite chain state outright;
- no caller identity at all, because ingress maps hostname to origin 1:1.

Requirements for operators:

- **Never point this tunnel at a chain holding value or real keys.** Anvil is a throwaway chain;
  every address it issues is disposable, and its state dies with the process.
- **Restrict the hostname before exposing anything real.** Choose one: (1) put **Cloudflare Access**
  in front of `rpc.008ai.online` in the `008ai.online` zone - a service-token or identity policy -
  and have the dashboard send `CF-Access-Client-Id` / `CF-Access-Client-Secret`; (2) add a **WAF /
  IP rule** that allows only the origin IPs that legitimately call the RPC (dashboard egress, CI) and
  blocks the rest; or (3) terminate the RPC behind an authenticating reverse proxy and aim the tunnel
  at that proxy rather than at the node.
- **Keep the ingress minimal.** `~/.cloudflared/config.yml` for tunnel `008-video` maps exactly
  `rpc.008ai.online` and rejects everything else with `http_status:404`. Keep it that way instead of
  adding a catch-all origin.
- **Check the guard, do not assume it.** While unprotected, this returns the dev accounts:
  `curl.exe -sS https://rpc.008ai.online -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_accounts","params":[]}'`.
  A hardened endpoint must not answer that anonymously.
- **Watch the tunnel.** `cloudflared` logs to stderr at
  `runtime_data/logs/cloudflared-008-video.err.log`; unexpected connection registrations or origin
  errors are an alert, not noise.

## Verification

```powershell
curl.exe -sSI https://maotang.008ai.online
curl.exe -sS https://maotang.008ai.online | Select-String "rpc\.008ai\.online"
```

The inlined beneficiary address appears in the client chunks as
`0x6aeceb240c902cc0a52ab7f0eb5bf6b1030077ea` (lowercased by the bundler) - grep the built
`/_next/static/chunks/*.js` payloads, not the HTML shell, and never print secrets while doing so.
