#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
PROJECT_ROOT="$(realpath "$SCRIPT_DIR/../..")"
CREDENTIALS="$HOME/.claude/.credentials.json"
DOTENV="$PROJECT_ROOT/.env"
LOGFILE="$PROJECT_ROOT/logs/oauth-refresh.log"
BUFFER_MS=$((5 * 60 * 1000))  # 5 minutes

log() {
  echo "$(date -Iseconds) $*" >> "$LOGFILE"
}

# --- Primary mode guard ---
# Only overwrite .env with short-lived credentials.json tokens when in fallback mode.
# In primary mode, .env has a long-term token that should not be replaced.
STATE_FILE="$PROJECT_ROOT/.oauth-state.json"
if [[ -f "$STATE_FILE" ]]; then
  using_fallback=$(jq -r '.usingFallback // false' "$STATE_FILE" 2>/dev/null || echo "false")
else
  using_fallback="false"
fi

if [[ "$using_fallback" != "true" ]]; then
  log "Primary mode — skipping refresh (.env has long-term token)"
  exit 0
fi

# --- Read credentials ---
if [[ ! -f "$CREDENTIALS" ]]; then
  log "ERROR: $CREDENTIALS not found"
  exit 1
fi

access_token=$(jq -r '.claudeAiOauth.accessToken' "$CREDENTIALS")
expires_at=$(jq -r '.claudeAiOauth.expiresAt' "$CREDENTIALS")

if [[ -z "$access_token" || "$access_token" == "null" ]]; then
  log "ERROR: no accessToken in credentials"
  exit 1
fi

if [[ -z "$expires_at" || "$expires_at" == "null" ]]; then
  log "WARN: no expiresAt in credentials, forcing refresh"
  expires_at=0
fi

now_ms=$(($(date +%s) * 1000))
remaining_ms=$((expires_at - now_ms))

# --- Refresh if expired or expiring within buffer ---
if (( remaining_ms <= BUFFER_MS )); then
  log "Token expired or expiring soon (remaining_ms=$remaining_ms), invoking claude CLI to refresh"

  # Find claude binary — check PATH, then common locations
  CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"
  if [[ -z "$CLAUDE_BIN" ]]; then
    for candidate in "$HOME/.claude/local/claude" "$HOME/.local/bin/claude"; do
      if [[ -x "$candidate" ]]; then
        CLAUDE_BIN="$candidate"
        break
      fi
    done
  fi

  if [[ -z "$CLAUDE_BIN" ]]; then
    log "ERROR: claude binary not found in PATH or common locations"
    exit 1
  fi

  if "$CLAUDE_BIN" -p "ok" --no-session-persistence 2>>"$LOGFILE" >/dev/null; then
    log "Claude CLI refreshed token successfully"
    # Re-read credentials after CLI refresh
    access_token=$(jq -r '.claudeAiOauth.accessToken' "$CREDENTIALS")
    expires_at=$(jq -r '.claudeAiOauth.expiresAt' "$CREDENTIALS")

    if [[ -z "$access_token" || "$access_token" == "null" ]]; then
      log "ERROR: no accessToken after CLI refresh"
      exit 1
    fi
  else
    cli_exit=$?
    log "ERROR: claude CLI refresh failed (exit $cli_exit). User may need to run 'claude login'."
    exit 1
  fi
else
  log "Token still fresh (remaining_ms=$remaining_ms), syncing to .env"
fi

# --- Update .env ---
if [[ -f "$DOTENV" ]]; then
  grep -v '^CLAUDE_CODE_OAUTH_TOKEN=' "$DOTENV" > "$DOTENV.tmp" || true
else
  : > "$DOTENV.tmp"
fi
echo "CLAUDE_CODE_OAUTH_TOKEN=${access_token}" >> "$DOTENV.tmp"
mv "$DOTENV.tmp" "$DOTENV"
log "Updated .env with token (expires_at=$expires_at)"
