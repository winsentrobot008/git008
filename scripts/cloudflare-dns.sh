#!/usr/bin/env bash
#
# Idempotent Cloudflare DNS record upsert for the 008 subdomains.
#
# Creates or updates a single DNS record through the Cloudflare API v4. The MAOTANG
# subdomains both live in the `008ai.online` zone:
#
#   maotang.008ai.online   CNAME   cname.vercel-dns.com             proxied=false  (Vercel custom domain)
#   rpc.008ai.online       CNAME   <tunnel-id>.cfargotunnel.com     proxied=true   (cloudflared tunnel route)
#
# `maotang` must stay DNS-only (grey cloud) because Vercel terminates TLS for
# cname.vercel-dns.com itself. `rpc` is normally created for you by
# `cloudflared tunnel route dns <tunnel> rpc.008ai.online`.
#
# Credentials are read from the environment and are never echoed:
#   CLOUDFLARE_API_TOKEN   required; needs Zone:DNS:Edit and Zone:Zone:Read
#   CLOUDFLARE_ZONE_ID     optional; looked up from --zone when unset
#
# Usage:
#   export CLOUDFLARE_API_TOKEN="..."
#   ./scripts/cloudflare-dns.sh --name maotang --content cname.vercel-dns.com --proxied false
#   ./scripts/cloudflare-dns.sh --name rpc --content <tunnel-id>.cfargotunnel.com --proxied true --dry-run
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

usage() {
  sed -n '3,26p' "$0" | sed 's/^# \{0,1\}//'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --name)    NAME="${2:-}"; shift 2 ;;
    --content) CONTENT="${2:-}"; shift 2 ;;
    --zone)    ZONE="${2:-}"; shift 2 ;;
    --type)    TYPE="${2:-}"; shift 2 ;;
    --proxied) PROXIED="${2:-}"; shift 2 ;;
    --ttl)     TTL="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -z "$NAME" ] || [ -z "$CONTENT" ]; then
  echo "ERROR: --name and --content are required" >&2
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

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN is not set (needs Zone:DNS:Edit and Zone:Zone:Read)" >&2
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

FQDN="$NAME"
case "$NAME" in
  *.*) ;;
  *) FQDN="$NAME.$ZONE" ;;
esac

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