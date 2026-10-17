#!/usr/bin/env bash
# MAOTANG one-command setup: install local dependencies, download the open-source quantized
# 0.5B SLM, verify its SHA-256, and launch the offline-first AI manager.
#
# macOS / Linux. On Windows use setup.bat.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$SCRIPT_DIR/config/model.json"
MODEL_DIR="$SCRIPT_DIR/models"
MANAGER="$SCRIPT_DIR/src/agent-manager.mjs"

DRY_RUN=0
SKIP_MODEL=0
NO_NATIVE=0
LAUNCH=1
RPC=""
EXTRA=()

usage() {
  cat <<'USAGE'
MAOTANG agent-manager setup

Usage: ./agent-manager/setup.sh [options] [manager args...]

Options:
  --dry-run          print the plan without installing, downloading or launching
  --skip-model       do not download the SLM weights
  --no-native        install without the optional native runtimes (simulated mode)
  --no-launch        set everything up but do not start the manager
  --model-dir PATH   where to store the model (default: agent-manager/models)
  --rpc URL          blockchain JSON-RPC endpoint passed to the manager
  -h, --help         show this help

Environment: MAOTANG_RPC_URL, MAOTANG_MODEL_PATH, MAOTANG_MODE, MAOTANG_THREADS
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --skip-model) SKIP_MODEL=1 ;;
    --no-native) NO_NATIVE=1 ;;
    --no-launch) LAUNCH=0 ;;
    --model-dir)
      MODEL_DIR="${2:?--model-dir requires a path}"
      shift
      ;;
    --rpc)
      RPC="${2:?--rpc requires a url}"
      EXTRA+=(--rpc "$2")
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *) EXTRA+=("$1") ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
run() {
  if [ "$DRY_RUN" = "1" ]; then
    say "  [dry-run] $*"
  else
    "$@"
  fi
}

# One field per line in the committed manifest keeps this reader dependency-free.
json_field() {
  sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\{0,1\}\([^",}]*\).*/\1/p' "$MANIFEST" | head -n 1
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  else
    echo "no sha256 tool found (need sha256sum, shasum or openssl)" >&2
    return 1
  fi
}

fetch_to() {
  target="$1"
  url="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -L --fail --retry 3 --output "$target" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$target" "$url"
  else
    echo "need curl or wget to download the model" >&2
    return 1
  fi
}

MODEL_URL="$(json_field url)"
MODEL_FILE="$(json_field filename)"
MODEL_SHA="$(json_field sha256)"
if [ -z "$MODEL_URL" ] || [ -z "$MODEL_FILE" ] || [ -z "$MODEL_SHA" ]; then
  echo "cannot read $MANIFEST" >&2
  exit 1
fi
MODEL_PATH="$MODEL_DIR/$MODEL_FILE"

step "Checking prerequisites"
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  say "  [warn] Node.js not found on PATH; need Node.js 20 or newer."
  if [ "$DRY_RUN" != "1" ]; then
    say "  [error] install Node.js 20 or newer and re-run"
    exit 1
  fi
else
  NODE_VERSION="$("$NODE_BIN" -p 'process.versions.node')"
  say "  node $NODE_VERSION at $NODE_BIN"
  NODE_MAJOR="${NODE_VERSION%%.*}"
  if [ "$NODE_MAJOR" -lt 20 ] && [ "$DRY_RUN" != "1" ]; then
    say "  [error] Node.js 20 or newer is required (found $NODE_VERSION)"
    exit 1
  fi
fi

step "Installing local dependencies"
NPM_OPTIONAL=""
if [ "$NO_NATIVE" = "1" ]; then
  NPM_OPTIONAL="--omit=optional"
fi
run npm --prefix "$REPO_ROOT/agent-client" install $NPM_OPTIONAL
run npm --prefix "$REPO_ROOT/agent-client" run build
run npm --prefix "$SCRIPT_DIR" install $NPM_OPTIONAL

step "Fetching the open-source quantized SLM"
say "  model:  $MODEL_FILE"
say "  source: $MODEL_URL"
say "  sha256: $MODEL_SHA"
if [ "$SKIP_MODEL" = "1" ]; then
  say "  skipped with --skip-model"
elif [ "$DRY_RUN" = "1" ]; then
  say "  [dry-run] download to $MODEL_PATH and verify sha256"
elif [ -f "$MODEL_PATH" ] && [ "$(sha256_of "$MODEL_PATH")" = "$MODEL_SHA" ]; then
  say "  already present and verified"
else
  mkdir -p "$MODEL_DIR"
  fetch_to "$MODEL_PATH.part" "$MODEL_URL"
  ACTUAL="$(sha256_of "$MODEL_PATH.part")"
  if [ "$ACTUAL" != "$MODEL_SHA" ]; then
    say "  [error] sha256 mismatch: expected $MODEL_SHA, got $ACTUAL"
    rm -f "$MODEL_PATH.part"
    exit 1
  fi
  mv "$MODEL_PATH.part" "$MODEL_PATH"
  say "  downloaded and verified"
fi

export MAOTANG_MODEL_PATH="$MODEL_PATH"
if [ -n "$RPC" ]; then
  export MAOTANG_RPC_URL="$RPC"
fi

step "Launching the AI manager"
if [ "$LAUNCH" != "1" ]; then
  say "  skipped with --no-launch"
  say "  start later with: node $MANAGER"
  exit 0
fi
if [ "$DRY_RUN" = "1" ]; then
  say "  [dry-run] node $MANAGER ${EXTRA[*]:-}"
  exit 0
fi
exec node "$MANAGER" ${EXTRA[@]+"${EXTRA[@]}"}
