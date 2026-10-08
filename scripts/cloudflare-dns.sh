#!/usr/bin/env bash
#
# Idempotent Cloudflare DNS record upsert for the 008 subdomains, plus a zero-credential
# tunnel route mode.
#
# Two modes, both aimed at the MAOTANG subdomains in the `008ai.online` zone:
#
#   1. API mode (default) - creates or updates one DNS record through the Cloudflare API v4.
#   2. --tunnel mode      - delegates to `cloudflared tunnel route dns <tunnel> <hostname>`,
#                           which needs no Cloudflare API token (it reuses
#                           ~/.cloudflared/cert.pem) and writes a proxied CNAME to
#                           <tunnel-id>.cfargotunnel.com.
#
# Records this repo cares about:
#
#   maotang.008ai.online   CNAME   cname.vercel-dns.com             proxied=false  (Vercel custom domain)
#   rpc.008ai.online       CNAME   <tunnel-id>.cfargotunnel.com     proxied=true   (cloudflared tunnel route)
#
# `maotang` must stay DNS-only (grey cloud) because Vercel terminates TLS for
# cname.vercel-dns.com itself and cannot verify a proxied record. `rpc` is created by the
# tunnel shortcut instead.
#
# Credentials are read from the environment and are never echoed:
#   CLOUDFLARE_API_TOKEN   required in API mode; needs Zone:DNS:Edit and Zone:Zone:Read
#   CLOUDFLARE_ZONE_ID     optional in API mode; looked up from --zone when unset
#
# Usage:
#   export CLOUDFLARE_API_TOKEN="..."
#   ./scripts/cloudflare-dns.sh --name maotang --content cname.vercel-dns.com --proxied false
#   ./scripts/cloudflare-dns.sh --name rpc --tunnel 008-video
#
set -euo pipefail

API="https://api.cloudflare.com/client/v4"
ZONE="${CLOUDFLARE_ZONE:-008ai.online}"
TYPE="CNAME"
PROXIED="false"
TTL="1"
DRY_RUN="0"
NAME=""
CONTENT=""
TUNNEL=""

usage() {
  awk 'NR>2 && /^#/ { sub(/^# ?/, ""); print; next } NR>2 { exit }' "$0"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --name)    NAME="${2:-}"; shift 2 ;;
    --content) CONTENT="${2:-}"; shift 2 ;;
    --zone)    ZONE="${2:-}"; shift 2 ;;
    --type)    TYPE="${2:-}"; shift 2 ;;
    --proxied) PROXIED="${2:-}"; shift 2 ;;
    --ttl)     TTL="${2:-}"; shift 2 ;;
    --tunnel)  TUNNEL="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -z "$NAME" ]; then
  echo "ERROR: --name is required" >&2
  usage >&2
  exit 2
fi

if [ -z "$TUNNEL" ] && [ -z "$CONTENT" ]; then
  echo "ERROR: --content is required unless --tunnel is used" >&2
  usage >&2
  exit 2
fi

case "$PROXIED" in
  true|false) ;;
  *) echo "ERROR: --proxied must be true or false" >&2; exit 2 ;;
esac

case "$TYPE" in
  A|AAAA|CNAME) ;;
  *) echo "ERROR: --type must be A, AAAA or CNAME" >&2; exit 2 ;;
esac

FQDN="$NAME"
case "$NAME" in
  *.*) ;;
  *) FQDN="$NAME.$ZONE" ;;
esac

# --- Mode 1: zero-credential tunnel route (no CLOUDFLARE_API_TOKEN needed) ----------------
if [ -n "$TUNNEL" ]; then
  CLOUDFLARED_BIN="$(command -v cloudflared || true)"
  if [ -z "$CLOUDFLARED_BIN" ]; then
    for candidate in "/c/Program Files (x86)/cloudflared/cloudflared.exe" \
                     "/c/Program Files/cloudflared/cloudflared.exe" \
                     "/usr/local/bin/cloudflared" \
                     "/usr/bin/cloudflared"; do
      if [ -x "$candidate" ]; then CLOUDFLARED_BIN="$candidate"; break; fi
    done
  fi
  if [ -z "$CLOUDFLARED_BIN" ]; then
    echo "ERROR: cloudflared not found on PATH; install it first" >&2
    exit 1
  fi
  echo "TUNNEL tunnel route dns $TUNNEL $FQDN"
  if [ "$DRY_RUN" = "1" ]; then echo "dry-run: no change sent"; exit 0; fi
  "$CLOUDFLARED_BIN" tunnel route dns "$TUNNEL" "$FQDN"
  echo "OK route $FQDN -> tunnel $TUNNEL (proxied CNAME to cfargotunnel.com)"
  exit 0
fi

# --- Mode 2: API upsert -------------------------------------------------------------------
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN is not set (needs Zone:DNS:Edit and Zone:Zone:Read). Use --tunnel for a token-free route" >&2
  exit 1
fi

# Cloudflare always serialises the record/zone id first inside each result object.
first_id() {
  if command -v jq >/dev/null 2>&1; then
    jq -r '.result[0].id // empty' 2>/dev/null || true
  else
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s).result;process.stdout.write(r&&r[0]&&r[0].id?r[0].id:"")}catch(e){}})' 2>/dev/null || true
  fi
}

cf() {
  local method="$1" path="$2" data="${3:-}"
  if [ -n "$data" ]; then
    curl -sS -X "$method" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" --data "$data" "$API$path"
  else
    curl -sS -X "$method" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$API$path"
  fi
}

ZONE_ID="${CLOUDFLARE_ZONE_ID:-}"
if [ -z "$ZONE_ID" ]; then
  ZONE_ID="$(cf GET "/zones?name=$ZONE" | first_id)"
fi
if [ -z "$ZONE_ID" ]; then
  echo "ERROR: zone '$ZONE' not found for this token" >&2
  exit 1
fi

RECORD_ID="$(cf GET "/zones/$ZONE_ID/dns_records?type=$TYPE&name=$FQDN" | first_id)"
BODY="$(printf '{"type":"%s","name":"%s","content":"%s","proxied":%s,"ttl":%s}' "$TYPE" "$FQDN" "$CONTENT" "$PROXIED" "$TTL")"

if [ -n "$RECORD_ID" ]; then
  echo "UPDATE $TYPE $FQDN -> $CONTENT (proxied=$PROXIED, id=$RECORD_ID)"
  if [ "$DRY_RUN" = "1" ]; then echo "dry-run: no change sent"; exit 0; fi
  cf PUT "/zones/$ZONE_ID/dns_records/$RECORD_ID" "$BODY"
else
  echo "CREATE $TYPE $FQDN -> $CONTENT (proxied=$PROXIED)"
  if [ "$DRY_RUN" = "1" ]; then echo "dry-run: no change sent"; exit 0; fi
  cf POST "/zones/$ZONE_ID/dns_records" "$BODY"
fi
echo