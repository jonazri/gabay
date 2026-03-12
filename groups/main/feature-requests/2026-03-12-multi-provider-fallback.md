# Feature Request: OpenRouter Fallback for Nanoclaw & Claude Code Harness

**Date:** 2026-03-12
**Status:** new
**Requested by:** Yonatan
**Priority:** important

## Problem

Nanoclaw currently depends exclusively on Anthropic's Claude API via a single Claude Code subscription token. When that token fails — due to API outages, rate limits, quota exhaustion, or authentication errors — message processing stops entirely and users experience a full outage. There is no graceful degradation or automatic recovery path.

Observed failure modes from production logs:
- `UNAUTHENTICATED` gRPC errors mid-session requiring manual OAuth refresh
- Potential for Claude API rate limits during high-volume periods (e.g., WhatsApp summary runs across many groups)

**Key constraint:** The fallback layer must have *zero impact on normal operation*. OpenRouter must not be in the request path at all when the primary token is healthy — no added latency, no extra hop.

## Proposed Solution

### Architecture: Bypass-by-Default, Activate-on-Failure

OpenRouter is used *exclusively* as a fallback. Normal requests go directly to Anthropic as today. OpenRouter is only activated in two ways:

1. **Automatic:** The harness detects a primary token failure and switches for the remainder of that session (or until primary recovers)
2. **Manual:** User runs a command (e.g., `/use-fallback` or `/switch-provider openrouter`) to explicitly activate fallback mode

```
Normal flow:
  Message → Harness → [ANTHROPIC_BASE_URL = default] → Anthropic API ✅

Fallback flow (auto or manual):
  Message → Harness → [ANTHROPIC_BASE_URL = openrouter] → OpenRouter → Anthropic/Gemini/OpenAI
```

### How to Hook Into Failure Events

The harness spawns Claude Code as a child process and captures its stdout/stderr. Failure signals to watch for:

**Exit codes:**
- Non-zero exit from `claude` process on first tool use / API call

**Stderr patterns (regex):**
```
/401|403|UNAUTHENTICATED/          → auth failure, trigger fallback
/429|rate.?limit|quota.?exceeded/  → rate limit, trigger fallback
/5[0-9]{2}|overloaded|unavailable/ → server error, trigger fallback
/ECONNREFUSED|ETIMEDOUT|ENOTFOUND/ → network failure, trigger fallback
```

**Detection flow:**
1. Harness starts Claude Code process with primary credentials
2. If failure pattern detected in stderr *before* the turn completes, harness:
   a. Terminates the current process
   b. Switches `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL` to fallback values
   c. Retries the entire turn with the same input message
   d. Notifies user that fallback is active
3. Subsequent turns continue using fallback until primary is restored

**Primary restore logic:**
- On each new turn while in fallback mode, optionally do a lightweight health check against the primary endpoint (e.g., a minimal API ping)
- If primary responds healthy, silently switch back
- Or: restore primary only on explicit `/restore-primary` command (simpler, less surprising)

### OpenRouter BYOK Setup

OpenRouter supports Bring Your Own Key — you supply your own provider API keys and OpenRouter routes through them. This keeps costs identical to going direct (no markup beyond OpenRouter's 5% fee on BYOK after 1M free requests).

Keys to configure in OpenRouter account + local config:
- **Anthropic key** — fallback to Claude models if subscription token fails
- **Google Gemini key** — fallback to Gemini 2.5 Pro/Flash
- **OpenAI key** — fallback to GPT-4.1 or o3

OpenRouter automatically selects the best available provider based on availability and cost. If Claude via Anthropic key is also unavailable, it can cascade to Gemini or OpenAI transparently.

### Configuration

`~/.config/nanoclaw/providers.json`:

```json
{
  "primary": {
    "type": "claude-code-subscription",
    "comment": "Default — uses managed Claude Code OAuth token, zero overhead"
  },
  "fallback": {
    "type": "openrouter",
    "baseUrl": "https://openrouter.ai/api/v1",
    "apiKey": "sk-or-...",
    "model": "anthropic/claude-sonnet-4.6",
    "byok": {
      "anthropic": "sk-ant-...",
      "google": "AIza...",
      "openai": "sk-..."
    },
    "comment": "Only activated on primary failure or manual override. BYOK keys registered in OpenRouter account."
  },
  "fallbackTriggers": ["401", "403", "429", "503", "timeout", "UNAUTHENTICATED"],
  "restorePolicy": "manual",
  "notifyOnFallback": true,
  "notifyOnRestore": true
}
```

`restorePolicy` options:
- `"manual"` — stay on fallback until user runs `/restore-primary` (default, predictable)
- `"auto"` — health-check primary on each turn, restore silently when healthy

### Notification Behavior

**On fallback activation:**
> ⚠️ Primary API unavailable (401 UNAUTHENTICATED) — switched to OpenRouter fallback. Run `/restore-primary` to switch back when resolved.

**On manual activation:**
> ✅ Switched to OpenRouter fallback mode. Run `/restore-primary` to return to primary.

**On restore:**
> ✅ Primary API restored — back to direct Anthropic connection.

## Alternatives Considered

- **Always route through OpenRouter (no bypass):** Rejected — adds latency and cost to every request. The whole point is zero overhead during normal operation.
- **LiteLLM self-hosted proxy:** More control but adds infrastructure to maintain. OpenRouter handles provider translation without self-hosting.
- **Per-provider fallback without OpenRouter:** Would require separate adapters for Gemini (different API format) and OpenAI. OpenRouter unifies all providers behind a single Anthropic-compatible endpoint — one integration covers all.
- **Manual-only fallback:** Not sufficient — if primary fails at 3am, messages queue until user notices. Automatic detection is essential.

## Acceptance Criteria

- [ ] Normal requests go directly to Anthropic — OpenRouter is NOT in the request path
- [ ] When primary token returns 401/429/5xx, harness detects the failure from stderr/exit code
- [ ] Failing turn is automatically retried via OpenRouter — zero message loss
- [ ] Fallback remains active for subsequent turns until restored
- [ ] User receives notification when fallback activates, including the failure reason
- [ ] Manual activation: `/use-fallback` command switches to OpenRouter immediately
- [ ] Manual restore: `/restore-primary` switches back to direct Anthropic
- [ ] `restorePolicy: "auto"` optionally health-checks primary and restores silently
- [ ] Config supports all three BYOK keys: Anthropic, Google (Gemini), OpenAI
- [ ] OpenRouter model is configurable (default: `anthropic/claude-sonnet-4.6` for seamless parity)
- [ ] `/check-providers` command shows status of primary + fallback reachability

## Technical Notes

### How Provider Injection Works

The harness injects three env vars into the container at startup:
- `ANTHROPIC_BASE_URL` — API endpoint (omit or set to default for primary; set to OpenRouter for fallback)
- `ANTHROPIC_AUTH_TOKEN` — API key / bearer token
- `ANTHROPIC_MODEL` — model identifier

Switching providers requires only changing these three values for the next process spawn — the Claude Code CLI needs no modification.

### OpenRouter Anthropic Compatibility

OpenRouter's Anthropic-compatible endpoint works natively with Claude Code:
```
ANTHROPIC_BASE_URL=https://openrouter.ai/api/v1
ANTHROPIC_AUTH_TOKEN=sk-or-your-openrouter-key
ANTHROPIC_MODEL=anthropic/claude-sonnet-4.6
```

BYOK keys are registered in your OpenRouter account settings — they don't need to be passed per-request. OpenRouter handles provider selection and cascading internally.

### Gemini / OpenAI via OpenRouter

Neither Gemini nor OpenAI speak the Anthropic Messages API natively. OpenRouter translates transparently — from the harness's perspective, it's still the same Anthropic-format call to the same OpenRouter endpoint. The BYOK Gemini/OpenAI keys are registered in OpenRouter; provider selection is handled by OpenRouter's routing logic.

### Relevant Files
- Host harness startup / container launch logic (wherever env vars are injected into container)
- Process stderr/stdout capture (where to inject the failure pattern detection)
- `~/.config/nanoclaw/` — config directory for host settings
- IPC task handling — `refresh_oauth` is the current manual recovery; this feature supersedes it for API-level failures
