#!/usr/bin/env sh
set -eu

MODE="${1:-mcp}"

case "$MODE" in
  mcp)
    shift || true
    exec node src/mcp.js "$@"
    ;;
  cli)
    shift || true
    exec node src/index.js "$@"
    ;;
  *)
    # Backward compatible mode: if the first arg is not a mode, treat all args as CLI args.
    exec node src/index.js "$@"
    ;;
esac
