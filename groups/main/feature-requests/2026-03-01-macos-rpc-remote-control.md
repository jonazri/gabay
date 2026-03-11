# Feature Request: macOS Remote Control via RPC Channel

**Date:** 2026-03-01
**Status:** new
**Requested by:** Yonatan
**Priority:** important

## Problem

Currently, Andy can control Google Home devices but cannot interact with the user's macOS system remotely. This limits automation capabilities and prevents integration with Mac-specific apps, files, and workflows.

**Missing capabilities:**
- Cannot control Mac apps (Music, Photos, Finder, Safari, etc.)
- Cannot run AppleScripts to automate macOS workflows
- Cannot execute shell commands on the Mac
- Cannot access Mac-specific data or files
- Cannot integrate Mac into home automation scenarios

**Current workaround:**
User must manually perform Mac-related tasks that could be automated via WhatsApp/Telegram commands.

## Proposed Solution

Implement a secure RPC (Remote Procedure Call) channel that enables Andy to send AppleScript commands and safe shell scripts to the user's macOS system.

### Architecture

```
┌─────────────────────┐
│  Andy (Container)   │
│                     │
│  Sends RPC request  │
└──────────┬──────────┘
           │
           │ IPC (JSON files)
           ▼
┌─────────────────────┐
│   Host (Node.js)    │
│                     │
│  - Validates        │
│  - Rate limits      │
│  - Executes         │
└──────────┬──────────┘
           │
           │ osascript / shell
           ▼
┌─────────────────────┐
│      macOS          │
│                     │
│  - Apps             │
│  - Files            │
│  - System           │
└─────────────────────┘
```

### IPC Protocol

**Request:** `/workspace/ipc/tasks/macos-{timestamp}.json`
```json
{
  "type": "macos_command",
  "requestId": "unique-id",
  "commandType": "applescript|shell",
  "command": "tell application \"Music\" to play",
  "timeout": 5000,
  "allowedApps": ["Music", "Photos", "Finder"]
}
```

**Response:** `/workspace/ipc/responses/macos-{requestId}.json`
```json
{
  "status": "ok|error",
  "stdout": "command output",
  "stderr": "error output if any",
  "exitCode": 0,
  "executionTime": 234
}
```

### Security Model (Recommended: Whitelist + Approval)

**Tier 1: Auto-approved safe commands**
- Music control: play, pause, next, volume
- Safari: open URL (with domain whitelist)
- System: get clipboard, set clipboard (text only)
- Finder: list files in ~/Downloads, ~/Desktop
- Photos: list albums, recent photos

**Tier 2: Approval-required commands**
- File operations: read/write/delete files
- Application control: launch/quit apps
- Custom AppleScripts
- Shell commands

**Tier 3: Blocked commands**
- System modification: sudo, rm -rf, chmod, etc.
- Network configuration
- Security settings
- Password/keychain access

### Rate Limiting
- Max 10 commands per minute
- Max 100 commands per hour
- Automatic throttling on rapid requests

## Use Cases

### 1. Music Control
```
User: "Play my chill playlist on Mac"
Andy: → osascript: tell application "Music" to play playlist "Chill"
Mac: 🎵 Playing
Andy: "Playing your Chill playlist"
```

### 2. File Access
```
User: "What files are in my Downloads folder?"
Andy: → shell: ls -1 ~/Downloads
Mac: → returns file list
Andy: "You have 12 files: [list]"
```

### 3. Home Automation Integration
```
Trigger: User leaves home
Andy: → osascript: tell application "Music" to pause
Andy: → osascript: tell application "Safari" to quit
Andy: "Paused music and closed Safari as you left home"
```

### 4. Screenshot/Screen Sharing
```
User: "Take a screenshot of my desktop"
Andy: → shell: screencapture -x ~/Desktop/screenshot.png
Andy: → reads file and sends via WhatsApp
```

### 5. Clipboard Integration
```
User: "Copy this link to my Mac clipboard: https://..."
Andy: → osascript: set the clipboard to "https://..."
Andy: "Link copied to your Mac clipboard"
```

## Alternatives Considered

### 1. SSH-based approach
- **Pros:** Standard, well-tested, flexible
- **Cons:** Requires SSH server, harder to sandbox, authentication complexity
- **Rejected:** IPC approach is simpler and already established

### 2. Browser extension
- **Pros:** Can control browser-based tasks
- **Cons:** Limited to browser, requires separate install, can't control native apps
- **Rejected:** Too limited in scope

### 3. Full VNC/screen control
- **Pros:** Complete control
- **Cons:** Massive security risk, overkill for automation
- **Rejected:** Violates security principles

## Acceptance Criteria

**Core Functionality:**
- [ ] RPC channel established via IPC (JSON task files)
- [ ] AppleScript execution working with output capture
- [ ] Shell command execution with safety checks
- [ ] Response includes stdout, stderr, exit code
- [ ] Timeout enforcement (default 5s, max 30s)

**Security:**
- [ ] Whitelist of auto-approved commands implemented
- [ ] Approval mechanism for tier-2 commands
- [ ] Blocklist prevents dangerous commands
- [ ] Rate limiting enforced (10/min, 100/hour)
- [ ] Command logging for audit trail

**Error Handling:**
- [ ] Clear error messages for blocked commands
- [ ] Timeout errors handled gracefully
- [ ] Permission errors reported clearly
- [ ] Invalid JSON rejected with helpful errors

**Documentation:**
- [ ] List of auto-approved commands
- [ ] Examples for common use cases
- [ ] Security best practices documented

## Technical Notes

### AppleScript Execution
```javascript
const { execFile } = require('child_process');

function runAppleScript(script, timeout = 5000) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout }, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stderr, exitCode: error.code });
      } else {
        resolve({ stdout: stdout.trim(), stderr, exitCode: 0 });
      }
    });
  });
}
```

### Shell Command Safety
```javascript
const BLOCKED_PATTERNS = [
  /sudo/i,
  /rm\s+-rf/i,
  /chmod\s+777/i,
  /curl.*\|.*sh/i,
  /\/etc\//,
  /\/usr\/bin/,
];

function isSafeCommand(cmd) {
  return !BLOCKED_PATTERNS.some(pattern => pattern.test(cmd));
}
```

### Whitelist Example
```javascript
const AUTO_APPROVED = {
  applescript: [
    'tell application "Music" to play',
    'tell application "Music" to pause',
    'tell application "Music" to next track',
    'tell application "Music" to set sound volume to *',
    'tell application "Safari" to open location "*"',
  ],
  shell: [
    'ls -1 ~/Downloads',
    'ls -1 ~/Desktop',
    'pbpaste',
    'echo "test"',
  ]
};
```

### Integration with Andy

Add to Andy's skills:

```bash
# In /workspace/project/skills/macos-control/skill.json
{
  "name": "macos-control",
  "description": "Control macOS apps and run AppleScripts remotely",
  "examples": [
    "macos-control:applescript 'tell application \"Music\" to play'",
    "macos-control:shell 'ls ~/Downloads'",
    "macos-control:music play",
    "macos-control:music volume 50"
  ]
}
```

Helper functions for common tasks:
```bash
macos-control:music play|pause|next|prev
macos-control:music volume <0-100>
macos-control:safari open <url>
macos-control:clipboard get|set <text>
macos-control:screenshot [filename]
macos-control:file list <path>
```

### Approval UI (for Tier 2 commands)

When a tier-2 command is requested:
1. Host pauses execution
2. Sends notification to user (via WhatsApp or system notification)
3. User approves/denies via reply or button
4. Command executes or returns "denied" error
5. Optionally: "Always allow this command" checkbox

### Logging & Audit Trail

All commands logged to `/workspace/project/logs/macos-commands.log`:
```
2026-03-01 15:30:45 | REQUEST  | applescript | "tell application \"Music\" to play" | approved
2026-03-01 15:30:46 | SUCCESS  | exit_code=0 | duration=234ms
2026-03-01 15:31:12 | REQUEST  | shell | "rm -rf /" | BLOCKED
2026-03-01 15:31:15 | REQUEST  | shell | "ls ~/Downloads" | approved
2026-03-01 15:31:15 | SUCCESS  | exit_code=0 | duration=45ms | files=12
```

## Reference: RCLI macOS Actions Catalog

[RCLI](https://github.com/RunanywhereAI/RCLI) (RunanywhereAI) is a local voice AI pipeline for Apple Silicon Macs that exposes **38 macOS actions** via AppleScript and shell — highly relevant as a reference for what actions to support in our implementation.

### RCLI's macOS Action Categories (reference for our whitelist)

RCLI supports actions across:
- **Spotify/Music:** play, pause, next, volume, playlist control
- **System:** volume up/down/mute, display brightness, screenshot
- **Messaging:** send iMessage, read recent messages
- **Reminders/Calendar:** create reminders, check upcoming events
- **Web:** open URLs in Safari, run searches
- **File operations:** list, open, move files via Finder
- **Clipboard:** get/set clipboard content

### How RCLI Executes Actions

Uses the same approach we proposed — `osascript` for AppleScript and shell for system commands. Their action definitions can serve as a reference for building our tier-1 auto-approved whitelist.

### Key Difference from Our Use Case

RCLI is a **local** voice-to-action pipeline (runs on the Mac itself). We need a **remote** channel (Andy in Docker → IPC → host → macOS). The action catalog is reusable; the transport layer is different.

### Recommended Actions to Port

Based on RCLI's catalog, prioritize these for tier-1 (auto-approved):
- Music/Spotify: play, pause, next, prev, volume, playlist
- System: volume, mute, brightness, sleep display
- Clipboard: get, set
- Screenshot: capture to file
- Reminders: create, list
- Calendar: list upcoming events
- Finder: list directory, open file/app
- Safari: open URL

---

## Related

This complements the existing Google Home integration. Together they enable comprehensive home automation:
- Google Home: IoT devices (lights, sensors, thermostats)
- macOS RPC: Computer automation (apps, files, scripts)

Future enhancements could include:
- Windows support (PowerShell remote execution)
- Linux support (SSH/shell integration)
- Cross-platform file sync
- Calendar/reminder integration (via macOS Calendar)
