#!/usr/bin/env bash
#
# MAOTANG Protocol - Alpha Testnet one-click launcher (Linux / macOS / WSL / Git Bash).
#
# Brings the protocol up on a local chain:
#   1. Reuse MAOTANG_RPC_URL, or a node already listening on :8545; otherwise spawn
#      `anvil --block-time 2` in the background.
#   2. Build the contract artifacts when they are missing, deploy the protocol set, and
#      write frontend/config/contracts.json.
#   3. Start the agent-client video worker, watching MemeTokenCreated on the new factory.
#   4. Start the Next.js launchpad frontend in the foreground.
#
# Ctrl-C tears down anything this script started (use --keep-anvil to keep the node).
#
# Usage: scripts/start-alpha.sh [--skip-deploy] [--skip-worker] [--skip-frontend] [--keep-anvil]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/contracts"
AGENT_CLIENT_DIR="$REPO_ROOT/agent-client"
FRONTEND_DIR="$REPO_ROOT/frontend"
CONTRACTS_JSON="$FRONTEND_DIR/config/contracts.json"
LOG_DIR="$REPO_ROOT/runtime_data/logs"

ANVIL_PORT="${ANVIL_PORT:-8545}"
ANVIL_BLOCK_TIME="${ANVIL_BLOCK_TIME:-2}"
DEFAULT_RPC="http://127.0.0.1:${ANVIL_PORT}"

# Public Anvil development key #0 (mnemonic "test test ... junk"). Not a secret: it is a
# documented constant controlling a throwaway local account. Override with DEPLOYER_PRIVATE_KEY.
ANVIL_DEV_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
# Address of that key, used to detect an unfunded default deployer on a public network.
ANVIL_DEV_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
# Stand-in graduation market, used when the target chain has no Uniswap deployment.
LOCAL_MARKET_STANDIN="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
# Stand-in registered agent address, until a real agent registers on the local chain.
LOCAL_AGENT="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

RPC_PROBE_BODY='{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'

SKIP_DEPLOY=0
SKIP_WORKER=0
SKIP_FRONTEND=0
KEEP_ANVIL=0

RPC_URL=""
FACTORY_ADDRESS=""
VAULT_ADDRESS=""
HUMAN_TOKEN_ADDRESS=""
ANVIL_PID=""
WORKER_PID=""
ANVIL_LOG=""
WORKER_LOG=""
DEPLOY_CMD=()

usage() {
  cat <<"USAGE"
MAOTANG Protocol - Alpha Testnet one-click launcher

Usage: scripts/start-alpha.sh [options]

Options:
  --skip-deploy    reuse the existing frontend/config/contracts.json
  --skip-worker    do not start the video worker daemon
  --skip-frontend  do not start Next.js; exit once the worker is up
  --keep-anvil     leave a spawned anvil running after the script exits
  -h, --help       show this help
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-deploy) SKIP_DEPLOY=1 ;;
    --skip-worker) SKIP_WORKER=1 ;;
    --skip-frontend) SKIP_FRONTEND=1 ;;
    --keep-anvil) KEEP_ANVIL=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf "unknown option: %s\n" "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [ -t 1 ]; then
  C_STEP="$(printf "\033[36m")"
  C_NOTE="$(printf "\033[90m")"
  C_OK="$(printf "\033[32m")"
  C_ERR="$(printf "\033[31m")"
  C_HEAD="$(printf "\033[35m")"
  C_WARN="$(printf "\033[33m")"
  C_OFF="$(printf "\033[0m")"
else
  C_STEP=""
  C_NOTE=""
  C_OK=""
  C_ERR=""
  C_HEAD=""
  C_WARN=""
  C_OFF=""
fi

step() { printf "\n%s==> %s%s\n" "$C_STEP" "$1" "$C_OFF"; }
note() { printf "%s    %s%s\n" "$C_NOTE" "$1" "$C_OFF"; }
die() { printf "%sERROR: %s%s\n" "$C_ERR" "$1" "$C_OFF" >&2; exit 1; }
warn() { printf "%s    WARNING: %s%s\n" "$C_WARN" "$1" "$C_OFF" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

run_in() {
  local dir="$1"
  shift
  note "> $*"
  ( cd "$dir" && "$@" )
}

# JSON-RPC probe: a body carrying a "result" member means a live endpoint.
http_post_json() {
  local url="$1" body="$2" timeout="$3"
  if have curl; then
    curl -sS --max-time "$timeout" -H "Content-Type: application/json" --data-binary "$body" "$url" 2>/dev/null
  elif have node; then
    node -e "const [u,b]=process.argv.slice(1);fetch(u,{method:\"POST\",headers:{\"content-type\":\"application/json\"},body:b}).then(r=>r.text()).then(t=>process.stdout.write(t)).catch(()=>process.exit(1))" "$url" "$body"
  elif have python3; then
    python3 -c "import sys,urllib.request;r=urllib.request.Request(sys.argv[1],data=sys.argv[2].encode(),headers={\"Content-Type\":\"application/json\"});sys.stdout.write(urllib.request.urlopen(r,timeout=float(sys.argv[3])).read().decode())" "$url" "$body" "$timeout"
  else
    return 1
  fi
}

rpc_up() {
  local out=""
  out="$(http_post_json "$1" "$RPC_PROBE_BODY" 3 || true)"
  [ -n "$out" ] || return 1
  printf "%s" "$out" | grep -q "\"result\""
}

wait_rpc() {
  local url="$1" timeout="${2:-40}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if rpc_up "$url"; then return 0; fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

# Node >= 22.18 strips TypeScript types natively, so the deploy script needs no loader.
node_strips_types() {
  have node || return 1
  local v major minor
  v="$(node --version 2>/dev/null | sed "s/^v//" || true)"
  [ -n "$v" ] || return 1
  major="${v%%.*}"
  minor="$(printf "%s" "$v" | cut -d. -f2)"
  case "$major" in ""|*[!0-9]*) return 1 ;; esac
  case "$minor" in ""|*[!0-9]*) minor=0 ;; esac
  if [ "$major" -gt 22 ]; then return 0; fi
  if [ "$major" -eq 22 ] && [ "$minor" -ge 18 ]; then return 0; fi
  return 1
}

initialize_anvil() {
  if [ -n "${MAOTANG_RPC_URL:-}" ]; then
    if rpc_up "$MAOTANG_RPC_URL"; then
      note "using MAOTANG_RPC_URL=$MAOTANG_RPC_URL"
      RPC_URL="$MAOTANG_RPC_URL"
      return 0
    fi
    die "MAOTANG_RPC_URL=$MAOTANG_RPC_URL is set but does not answer eth_chainId"
  fi

  if rpc_up "$DEFAULT_RPC"; then
    note "reusing the node already listening on $DEFAULT_RPC"
    RPC_URL="$DEFAULT_RPC"
    return 0
  fi

  if ! have anvil; then
    die "no RPC endpoint is reachable and anvil is not on PATH. Install Foundry (https://getfoundry.sh) or set MAOTANG_RPC_URL."
  fi

  mkdir -p "$LOG_DIR"
  ANVIL_LOG="$LOG_DIR/alpha-anvil.log"
  note "spawning: anvil --block-time $ANVIL_BLOCK_TIME --port $ANVIL_PORT"
  anvil --block-time "$ANVIL_BLOCK_TIME" --port "$ANVIL_PORT" >"$ANVIL_LOG" 2>&1 &
  ANVIL_PID=$!
  note "anvil pid $ANVIL_PID, log: $ANVIL_LOG"

  if ! wait_rpc "$DEFAULT_RPC" 40; then
    die "anvil did not become reachable on $DEFAULT_RPC; see $ANVIL_LOG"
  fi
  RPC_URL="$DEFAULT_RPC"
}

initialize_contracts() {
  if [ ! -d "$CONTRACTS_DIR/out" ]; then
    if ! have forge; then
      die "contracts/out is missing and forge is not on PATH. Run forge build in contracts/ first."
    fi
    run_in "$CONTRACTS_DIR" forge build
  fi
  if [ ! -d "$CONTRACTS_DIR/node_modules/ethers" ]; then
    run_in "$CONTRACTS_DIR" npm install --no-audit --no-fund
  fi
}

# Prefers Node native TypeScript execution; falls back to a locally installed runner.
resolve_deploy_cmd() {
  local script="$CONTRACTS_DIR/scripts/deploy-testnet.ts"
  [ -f "$script" ] || die "missing $script"
  if node_strips_types; then
    DEPLOY_CMD=(node "$script")
    return 0
  fi
  local runner
  for runner in tsx ts-node; do
    if [ -x "$CONTRACTS_DIR/node_modules/.bin/$runner" ]; then
      DEPLOY_CMD=("$CONTRACTS_DIR/node_modules/.bin/$runner" "$script")
      return 0
    fi
  done
  if have npx; then
    DEPLOY_CMD=(npx ts-node "$script")
    return 0
  fi
  die "this Node cannot execute TypeScript directly. Install tsx or ts-node in contracts/, or use Node >= 22.18."
}

# Loopback endpoints are disposable local chains; anything else spends real funds against a real
# graduation market, so those two inputs are validated before a single transaction is attempted.
is_public_rpc() {
  local rest="$1" host=""
  rest="${rest#*://}"
  rest="${rest%%/*}"
  case "$rest" in
    \[*\]*) host="${rest%%]*}"; host="${host#[}" ;;
    *) host="${rest%%:*}" ;;
  esac
  case "$host" in
    ""|localhost|::1|0.0.0.0) return 1 ;;
    127.*) return 1 ;;
  esac
  return 0
}

assert_deploy_preflight() {
  local url="$1" key=""

  is_public_rpc "$url" || return 0

  if [ -n "${DEPLOYER_PRIVATE_KEY:-}" ]; then
    key="$DEPLOYER_PRIVATE_KEY"
  elif [ -n "${PRIVATE_KEY:-}" ]; then
    key="$PRIVATE_KEY"
  fi

  if [ -z "$key" ]; then
    warn "MAOTANG_RPC_URL=$url is a public network, but no deployer key is set."
    warn "The launcher would fall back to the public Anvil development key, whose address"
    warn "$ANVIL_DEV_ADDRESS holds no funds there, so deployment would fail with INSUFFICIENT_FUNDS."
    printf "\n" >&2
    warn "Set a funded account, then re-run:"
    warn "    export DEPLOYER_PRIVATE_KEY=0x..."
    warn "    scripts/start-alpha.sh"
    exit 1
  fi

  if [ "$(printf "%s" "$key" | tr "[:upper:]" "[:lower:]")" = "$ANVIL_DEV_KEY" ]; then
    warn "MAOTANG_RPC_URL=$url is a public network, but the deployer is still the public Anvil"
    warn "development key (address $ANVIL_DEV_ADDRESS). That account holds no funds there."
    printf "\n" >&2
    warn "Set a funded account, then re-run:"
    warn "    export DEPLOYER_PRIVATE_KEY=0x..."
    warn "    scripts/start-alpha.sh"
    exit 1
  fi

  if [ -n "${PRIVATE_KEY:-}" ] && [ -z "${DEPLOYER_PRIVATE_KEY:-}" ]; then
    export DEPLOYER_PRIVATE_KEY="$PRIVATE_KEY"
    note "using PRIVATE_KEY as DEPLOYER_PRIVATE_KEY"
  fi

  if [ -z "${UNISWAP_V3_POSITION_MANAGER:-}" ]; then
    warn "UNISWAP_V3_POSITION_MANAGER is unset while deploying to $url."
    warn "Graduation would be pinned to the stand-in address $LOCAL_MARKET_STANDIN, which is not a"
    warn "real Uniswap V3 position manager on a public chain."
    warn "Set it to the target chain nonfungible position manager, e.g. Base Sepolia:"
    warn "    export UNISWAP_V3_POSITION_MANAGER=0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1"
  fi
}

invoke_deploy() {
  mkdir -p "$(dirname "$CONTRACTS_JSON")"

  assert_deploy_preflight "$RPC_URL"

  # deploy-testnet.ts reads MAOTANG_TESTNET_RPC_URL, falling back to TESTNET_RPC_URL.
  export MAOTANG_TESTNET_RPC_URL="$RPC_URL"
  export DEPLOYER_PRIVATE_KEY="${DEPLOYER_PRIVATE_KEY:-$ANVIL_DEV_KEY}"
  export MAOTANG_OWNER="${MAOTANG_OWNER:-$LOCAL_AGENT}"
  export MAOTANG_SHARE_BASE_URL="${MAOTANG_SHARE_BASE_URL:-http://127.0.0.1:3000}"
  if [ -z "${UNISWAP_V3_POSITION_MANAGER:-}" ]; then
    export UNISWAP_V3_POSITION_MANAGER="$LOCAL_MARKET_STANDIN"
    note "UNISWAP_V3_POSITION_MANAGER unset; using the stand-in market ($LOCAL_MARKET_STANDIN)"
  fi

  resolve_deploy_cmd
  run_in "$CONTRACTS_DIR" "${DEPLOY_CMD[@]}"

  [ -f "$CONTRACTS_JSON" ] || die "deployment did not write $CONTRACTS_JSON"
}

# Flattens the deployment manifest into shell assignments, including the frontend env exports.
load_deployment() {
  have node || die "cannot find node on PATH"
  local dump
  dump="$(node -e "const fs=require(\"fs\");const d=JSON.parse(fs.readFileSync(process.argv[1],\"utf8\"));const c=d.contracts||{};const fe=d.frontendEnv||{};const out=[];out.push(\"FACTORY_ADDRESS=\"+JSON.stringify(c.MaoTangFactory||\"\"));out.push(\"VAULT_ADDRESS=\"+JSON.stringify(c.MaoTangSustenanceVault||\"\"));out.push(\"HUMAN_TOKEN_ADDRESS=\"+JSON.stringify(c.HumanToken||\"\"));for(const k of Object.keys(fe)){if(fe[k])out.push(\"export \"+k+\"=\"+JSON.stringify(String(fe[k])));}process.stdout.write(out.join(String.fromCharCode(10)));" "$CONTRACTS_JSON")"
  eval "$dump"
}

start_video_worker() {
  local dist_entry="$AGENT_CLIENT_DIR/dist/video-worker.js"
  if [ ! -f "$dist_entry" ]; then
    if [ ! -d "$AGENT_CLIENT_DIR/node_modules" ]; then
      run_in "$AGENT_CLIENT_DIR" npm install --no-audit --no-fund
    fi
    run_in "$AGENT_CLIENT_DIR" npm run build
  fi
  [ -f "$dist_entry" ] || die "missing $dist_entry after build"

  export MAOTANG_RPC_URL="$RPC_URL"
  export MAOTANG_FACTORY_ADDRESS="$FACTORY_ADDRESS"
  export MAOTANG_AGENT_ID="${MAOTANG_AGENT_ID:-$LOCAL_AGENT}"
  export MAOTANG_TELEMETRY_URL="${MAOTANG_TELEMETRY_URL:-http://127.0.0.1:8787/telemetry/proof}"
  export MAOTANG_VIDEO_OUTPUT="${MAOTANG_VIDEO_OUTPUT:-$REPO_ROOT/runtime_data/video-promos}"

  mkdir -p "$LOG_DIR"
  WORKER_LOG="$LOG_DIR/alpha-video-worker.log"
  ( cd "$AGENT_CLIENT_DIR" && exec node dist/video-worker.js ) >"$WORKER_LOG" 2>&1 &
  WORKER_PID=$!
  note "video worker pid $WORKER_PID, log: $WORKER_LOG"
}

cleanup() {
  local code=$?
  if [ -n "$WORKER_PID" ] && kill -0 "$WORKER_PID" 2>/dev/null; then
    note "stopping video worker (pid $WORKER_PID)"
    kill "$WORKER_PID" 2>/dev/null || true
  fi
  if [ -n "$ANVIL_PID" ] && [ "$KEEP_ANVIL" -eq 0 ] && kill -0 "$ANVIL_PID" 2>/dev/null; then
    note "stopping anvil (pid $ANVIL_PID)"
    kill "$ANVIL_PID" 2>/dev/null || true
  fi
  return "$code"
}
trap cleanup EXIT

printf "%sMAOTANG Protocol - Alpha Testnet launcher%s\n" "$C_HEAD" "$C_OFF"
note "repository: $REPO_ROOT"

step "1/4  resolving the RPC endpoint"
initialize_anvil

if [ "$SKIP_DEPLOY" -eq 1 ]; then
  step "2/4  deployment skipped; reading the existing contracts.json"
  [ -f "$CONTRACTS_JSON" ] || die "--skip-deploy was passed but $CONTRACTS_JSON does not exist"
else
  step "2/4  building and deploying the protocol set"
  initialize_contracts
  invoke_deploy
fi

load_deployment
[ -n "$FACTORY_ADDRESS" ] || die "contracts.json has no contracts.MaoTangFactory entry"
note "factory (bonding-curve router): $FACTORY_ADDRESS"
note "vault: $VAULT_ADDRESS   mHUMAN: $HUMAN_TOKEN_ADDRESS"

if [ "$SKIP_WORKER" -eq 1 ]; then
  step "3/4  video worker skipped"
else
  step "3/4  starting the video worker daemon"
  start_video_worker
fi

if [ "$SKIP_FRONTEND" -eq 1 ]; then
  step "4/4  frontend skipped"
  printf "\n%sAlpha testnet is up. RPC=%s factory=%s%s\n" "$C_OK" "$RPC_URL" "$FACTORY_ADDRESS" "$C_OFF"
  if [ "$KEEP_ANVIL" -eq 0 ]; then
    note "exiting; spawned processes will be stopped (use --keep-anvil to keep anvil)"
  fi
else
  step "4/4  starting the frontend"
  export NEXT_PUBLIC_MAOTANG_RPC_URL="$RPC_URL"
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    run_in "$FRONTEND_DIR" npm install --no-audit --no-fund
  fi
  printf "\n%s==> Next.js launchpad: http://127.0.0.1:3000  (Ctrl-C to stop)%s\n" "$C_OK" "$C_OFF"
  cd "$FRONTEND_DIR"
  npm run dev
fi
