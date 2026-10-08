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
that exposes, by design - which is why the guard in the next section is mandatory rather than
optional. What an *unguarded* node hands out:

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
- **Check the guard, do not assume it.** This must answer `403` with `x-rpc-guard: blocked` and a
  `-32601` JSON-RPC error, not the dev accounts:
  `curl.exe -sS https://rpc.008ai.online -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_accounts","params":[]}'`.
  Still returning the accounts means `scripts/rpc-guard.mjs` is not in the path - check the tunnel
  ingress before anything else.
- **Watch the tunnel.** `cloudflared` logs to stderr at
  `runtime_data/logs/cloudflared-008-video.err.log`; unexpected connection registrations or origin
  errors are an alert, not noise.

## RPC hardening: local guard plus an edge rule

Two independent layers keep `anvil_*` / `evm_*` administration off the public hostname. Neither is
enough on its own: a local proxy is exact because it understands JSON-RPC, but it only protects while
it runs; an edge rule keeps holding while the origin is unhealthy, but it only matches on body text.
Run both.

**Layer 1 - `scripts/rpc-guard.mjs`, the origin.** A dependency-free reverse proxy that forwards
everything except the privileged namespaces (`anvil_*`, `evm_*`, `debug_*`, `trace_*`, `admin_*`,
`personal_*`, `txpool_*`, `miner_*`, `hardhat_*`, `erigon_*`, `parity_*`) and the methods that sign or
spend with Anvil's ten unlocked accounts (`eth_accounts`, `eth_sendTransaction`, `eth_signTransaction`,
`eth_sign`, `eth_signTypedData*`). A refusal is `403` carrying a JSON-RPC error, the caller's own `id`
and `x-rpc-guard: blocked`; a batch is refused whole rather than half-answered. `eth_sendRawTransaction`
stays allowed, because broadcasting a signature the caller already holds is not privileged.

```powershell
# Start the guard before the tunnel, or the hostname answers Cloudflare 502.
# `node` must be on PATH; this repo's portable runtime is under products/4DNomad/runtime/toolchain/.
Start-Process -WindowStyle Hidden -FilePath node -ArgumentList @(
    'scripts/rpc-guard.mjs', '--listen', '127.0.0.1:8546', '--target', 'http://127.0.0.1:8545') `
  -RedirectStandardOutput runtime_data/logs/rpc-guard-8546.out.log `
  -RedirectStandardError runtime_data/logs/rpc-guard-8546.err.log
```

It logs one JSON line per blocked attempt with the real client address from `Cf-Connecting-Ip`, which
is what makes abuse triage possible behind the tunnel. Nothing else is logged unless `--log-forwards`
is passed. `--deny` adds a stricter rule (for example `--deny eth_sendRawTransaction`) and `--allow`
carves one back out.

The tunnel ingress must point at the guard and never at the node:

```yaml
# ~/.cloudflared/config.yml
ingress:
  - hostname: rpc.008ai.online
    service: http://127.0.0.1:8546
  - service: http_status:404
```

**Layer 2 - a Cloudflare WAF custom rule, the edge.** `./scripts/cloudflare-waf.ps1` prints the rule
and the dashboard path; `-Apply` upserts it into the zone `http_request_firewall_custom` phase (needs
`CLOUDFLARE_API_TOKEN` with `Zone:Zone:Read` and `Zone:WAF:Edit`), and `-Remove -Apply` takes it back
out. The expression is

```
(http.host eq "rpc.008ai.online" and http.request.method eq "POST"
 and (http.request.body.raw contains "anvil_" or http.request.body.raw contains "evm_"))
```

A custom rule only inspects the first 128 KB of a request body, which is exactly why the method-level
guard remains the layer that has to be correct.

**Verify the result.** `200` for a read, `403` for an admin method, and the deployment still intact:

```powershell
curl.exe -sS -o NUL -w "%{http_code}`n" https://rpc.008ai.online -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
curl.exe -sS -o NUL -w "%{http_code}`n" https://rpc.008ai.online -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":2,"method":"evm_mine","params":[]}'
```

## Verification

```powershell
curl.exe -sSI https://maotang.008ai.online
curl.exe -sS https://maotang.008ai.online | Select-String "rpc\.008ai\.online"
```

The inlined beneficiary address appears in the client chunks as
`0x6aeceb240c902cc0a52ab7f0eb5bf6b1030077ea` (lowercased by the bundler) - grep the built
`/_next/static/chunks/*.js` payloads, not the HTML shell, and never print secrets while doing so.
