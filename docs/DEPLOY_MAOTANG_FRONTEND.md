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
- `rpc.008ai.online` is also currently unregistered; the deployed bundle inlines the configured
  value regardless of whether that hostname resolves yet.

## Verification

```powershell
curl.exe -sSI https://maotang.008ai.online
curl.exe -sS https://maotang.008ai.online | Select-String "rpc\.008ai\.online"
```

The inlined beneficiary address appears in the client chunks as
`0x6aeceb240c902cc0a52ab7f0eb5bf6b1030077ea` (lowercased by the bundler) - grep the built
`/_next/static/chunks/*.js` payloads, not the HTML shell, and never print secrets while doing so.