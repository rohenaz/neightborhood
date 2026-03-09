#!/usr/bin/env bash
# Wrapper script to launch the neighborhood MCP server.
# The server inherits env vars from your shell (export FBI_API_KEY=... in ~/.zshrc).
# Optionally, place a .env file next to this script or at ~/.config/neighborhood/.env.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source .env if present (local dev or user-created)
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
elif [[ -f "$HOME/.config/neighborhood/.env" ]]; then
  set -a
  source "$HOME/.config/neighborhood/.env"
  set +a
fi

# Use bun if available (local dev), fall back to node (Claude Desktop VM)
if command -v bun >/dev/null 2>&1; then
  exec bun run "$SCRIPT_DIR/src/index.ts"
else
  exec node "$SCRIPT_DIR/build/server.js"
fi
