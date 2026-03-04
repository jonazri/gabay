# Feature Request: GitHub Gist File Sharing

**Date:** 2026-03-03
**Status:** new
**Requested by:** Yonatan Azrielant
**Priority:** important

## Problem

Andy can read and generate files in the container but has no way to share them with the user in a convenient format. Currently:
- WhatsApp doesn't support file attachments from Andy (only text messages)
- Copying large files via text is impractical and unreadable
- User must manually access the host filesystem or container to retrieve files
- Screenshots and generated content can't be delivered directly

This creates friction when Andy generates reports, configs, scripts, or any file content that the user needs.

## Proposed Solution

Add a GitHub Gist integration that creates private gists using the user's authenticated GitHub account, then returns shareable URLs.

### User Flow

1. User asks: "Show me the nginx config you generated"
2. Andy creates a private gist with the file content
3. Andy replies: "Here's your nginx config: https://gist.github.com/username/abc123"
4. User clicks the URL and views the file in GitHub's interface (syntax highlighting, raw download, etc.)

### API Design

#### Tool 1: Create Gist

`mcp__nanoclaw__create_gist`

```typescript
interface CreateGistParams {
  files: {
    [filename: string]: {
      content: string;
    };
  };
  description?: string;
  public?: boolean;  // Default: false (private)
}

interface CreateGistResponse {
  url: string;           // https://gist.github.com/username/gist_id
  html_url: string;      // Same as url for consistency
  raw_urls: {
    [filename: string]: string;  // Direct raw file URLs
  };
  gist_id: string;
}
```

#### Tool 2: Read Gist

`mcp__nanoclaw__read_gist`

```typescript
interface ReadGistParams {
  gist_id: string;       // Gist ID or full URL
  include_history?: boolean;  // Default: false
}

interface GistCommit {
  version: string;       // Commit SHA
  committed_at: string;  // ISO timestamp
  change_status: {
    [filename: string]: {
      additions: number;
      deletions: number;
      changes: number;
    };
  };
}

interface ReadGistResponse {
  gist_id: string;
  description: string;
  url: string;
  files: {
    [filename: string]: {
      content: string;
      size: number;
      raw_url: string;
    };
  };
  created_at: string;
  updated_at: string;
  history?: GistCommit[];  // Only if include_history=true
}
```

#### Tool 3: Get Gist Diff

`mcp__nanoclaw__get_gist_diff`

```typescript
interface GetGistDiffParams {
  gist_id: string;
  from_version?: string;  // SHA or "initial", defaults to previous commit
  to_version?: string;    // SHA or "latest", defaults to latest
}

interface FileDiff {
  filename: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  patch: string;         // Unified diff format
  old_content?: string;  // Full old content
  new_content?: string;  // Full new content
}

interface GetGistDiffResponse {
  from_version: string;
  to_version: string;
  files: FileDiff[];
  summary: {
    files_changed: number;
    insertions: number;
    deletions: number;
  };
}
```

#### Tool 4: Apply Gist Changes

`mcp__nanoclaw__apply_gist_changes`

```typescript
interface ApplyGistChangesParams {
  gist_id: string;
  target_path: string;    // Directory to apply changes to
  version?: string;       // Specific version to apply, defaults to latest
  files?: string[];       // Specific files to apply, defaults to all
  dry_run?: boolean;      // Preview changes without applying
}

interface ApplyGistChangesResponse {
  applied_files: string[];
  skipped_files: string[];
  conflicts: string[];
  preview?: {            // Only if dry_run=true
    [filepath: string]: {
      current_content: string;
      new_content: string;
      diff: string;
    };
  };
}
```

### Example Usage

#### Creating a Gist

```javascript
// Single file
const gist = await mcp__nanoclaw__create_gist({
  files: {
    "nginx.conf": {
      content: nginxConfigContent
    }
  },
  description: "Nginx configuration for myapp.com"
});

await mcp__nanoclaw__send_message({
  text: `Here's your nginx config: ${gist.url}`
});

// Multiple files
const gist = await mcp__nanoclaw__create_gist({
  files: {
    "package.json": { content: packageJson },
    "tsconfig.json": { content: tsconfigJson },
    "README.md": { content: readme }
  },
  description: "TypeScript project setup"
});

await mcp__nanoclaw__send_message({
  text: `I've created your project files: ${gist.url}\n\nFiles:\n• package.json\n• tsconfig.json\n• README.md`
});
```

#### Collaborative Workflow: Andy → User → Andy

```javascript
// 1. Andy creates initial gist
const gist = await mcp__nanoclaw__create_gist({
  files: {
    "config.yaml": { content: initialConfig }
  },
  description: "Initial configuration"
});

await mcp__nanoclaw__send_message({
  text: `Here's the config: ${gist.url}\n\nReview and make any changes you need!`
});

// 2. User edits the gist on GitHub (adds environment variables, tweaks settings)

// 3. User asks: "Apply those changes to the local config"

// 4. Andy reads the updated gist
const updated = await mcp__nanoclaw__read_gist({
  gist_id: gist.gist_id,
  include_history: true
});

await mcp__nanoclaw__send_message({
  text: `I see you made ${updated.history.length} update(s). Let me check what changed...`
});

// 5. Andy gets the diff
const diff = await mcp__nanoclaw__get_gist_diff({
  gist_id: gist.gist_id,
  from_version: "initial",
  to_version: "latest"
});

await mcp__nanoclaw__send_message({
  text: `Changes:\n• ${diff.summary.files_changed} file(s) modified\n• ${diff.summary.insertions} additions\n• ${diff.summary.deletions} deletions\n\nApplying now...`
});

// 6. Andy applies the changes
const result = await mcp__nanoclaw__apply_gist_changes({
  gist_id: gist.gist_id,
  target_path: "/workspace/group/config/",
  dry_run: false
});

await mcp__nanoclaw__send_message({
  text: `✅ Applied your changes to config.yaml!`
});
```

#### Reading Gist History

```javascript
// User asks: "What changed in that gist since I last saw it?"

const gist = await mcp__nanoclaw__read_gist({
  gist_id: "abc123def456",
  include_history: true
});

const changesSummary = gist.history.map(commit =>
  `• ${commit.committed_at}: ${Object.keys(commit.change_status).length} file(s) changed`
).join('\n');

await mcp__nanoclaw__send_message({
  text: `Gist history:\n${changesSummary}`
});
```

### Backend Implementation Architecture

**Security Model:** Instead of giving the container direct access to GitHub CLI (`gh`), which would provide full GitHub API access, this implementation uses a **custom Gist CLI tool** (`gist`) with a **host-side proxy component**.

**Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│ Container (Andy)                                            │
│                                                             │
│  Andy invokes:                                             │
│  $ gist create config.yaml --description "My config"       │
│                                                             │
│  Custom CLI tool: /usr/local/bin/gist                     │
│  ├── Validates input                                       │
│  ├── Formats request JSON                                  │
│  └── Sends to host via IPC socket                         │
│                                                             │
└─────────────────┬───────────────────────────────────────────┘
                  │ IPC Socket
                  │ /workspace/ipc/gist_requests/
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ Host System (Gist Proxy Service)                           │
│                                                             │
│  Gist Proxy Daemon:                                        │
│  ├── Reads requests from IPC directory                     │
│  ├── Validates against allowlist:                          │
│  │   • Only gist operations (no repos, issues, PRs)        │
│  │   • Rate limiting (10 gists/hour)                       │
│  │   • Size limits (10 MB per file)                        │
│  ├── Calls GitHub API using host's gh auth                 │
│  └── Returns response via IPC                              │
│                                                             │
└─────────────────┬───────────────────────────────────────────┘
                  │ HTTPS
                  ▼
            GitHub API (/gists endpoint)
```

**Key Security Benefits:**
1. **Scoped access:** Container can ONLY create/read gists, not access repos, issues, or other GitHub resources
2. **Rate limiting:** Host enforces per-hour limits to prevent abuse
3. **Validation:** Host validates all parameters before GitHub API calls
4. **Auditability:** All gist operations logged on host
5. **Credential isolation:** GitHub auth token never exposed to container

### Custom Gist CLI Tool

The container has access to a custom `gist` CLI tool (not the full `gh` CLI):

```bash
# Container has this tool available:
/usr/local/bin/gist

# Usage:
gist create <file> [--description "text"] [--public]
gist create-multi <dir> [--description "text"]
gist read <gist_id>
gist diff <gist_id> [--from <sha>] [--to <sha>]
gist apply <gist_id> <target_dir> [--dry-run]
gist list [--limit 10]
```

**Tool Capabilities (Allowed Operations Only):**
- Create gist (single or multi-file)
- Read gist content
- Get gist diff between versions
- Apply gist to local directory
- List recent gists

**Not Allowed (Security Boundary):**
- Access to repositories
- Create/modify issues or PRs
- Access to GitHub Actions
- Organization/team management
- Any non-gist GitHub API operations

### Host-Side Proxy Implementation

**IPC Directory Structure:**
```
/workspace/ipc/
├── gist_requests/
│   ├── create_1709584320123.json     # Request from container
│   └── create_1709584320123.response.json  # Response from host
└── gist_proxy.log                    # Audit log
```

**Request Format (Container → Host):**
```json
{
  "operation": "create",
  "request_id": "1709584320123",
  "timestamp": "2026-03-04T19:30:00Z",
  "params": {
    "files": {
      "config.yaml": {
        "content": "server:\n  port: 8080\n..."
      }
    },
    "description": "My configuration",
    "public": false
  }
}
```

**Response Format (Host → Container):**
```json
{
  "request_id": "1709584320123",
  "status": "success",
  "timestamp": "2026-03-04T19:30:01Z",
  "result": {
    "url": "https://gist.github.com/username/abc123def456",
    "html_url": "https://gist.github.com/username/abc123def456",
    "gist_id": "abc123def456",
    "raw_urls": {
      "config.yaml": "https://gist.githubusercontent.com/username/abc123def456/raw/config.yaml"
    }
  }
}
```

**Error Response:**
```json
{
  "request_id": "1709584320123",
  "status": "error",
  "timestamp": "2026-03-04T19:30:01Z",
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Maximum 10 gists per hour exceeded. Try again in 45 minutes."
  }
}
```

**Host Proxy Service (Systemd):**

```javascript
// /usr/local/bin/gist-proxy-daemon
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const chokidar = require('chokidar');

const IPC_DIR = '/workspace/ipc/gist_requests';
const RATE_LIMIT = 10; // gists per hour
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

class GistProxy {
  constructor() {
    this.requestCounts = new Map(); // Track rate limits
  }

  async start() {
    console.log('Gist proxy daemon starting...');

    // Watch for new request files
    const watcher = chokidar.watch(`${IPC_DIR}/*.json`, {
      ignored: /\.response\.json$/,
      persistent: true
    });

    watcher.on('add', async (filepath) => {
      await this.handleRequest(filepath);
    });

    console.log(`Watching ${IPC_DIR} for gist requests`);
  }

  async handleRequest(filepath) {
    const request = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    const responseFile = filepath.replace('.json', '.response.json');

    try {
      // Validate request
      this.validateRequest(request);

      // Check rate limit
      this.checkRateLimit();

      // Execute operation
      let result;
      switch (request.operation) {
        case 'create':
          result = await this.createGist(request.params);
          break;
        case 'read':
          result = await this.readGist(request.params);
          break;
        case 'diff':
          result = await this.getGistDiff(request.params);
          break;
        case 'list':
          result = await this.listGists(request.params);
          break;
        default:
          throw new Error(`Unknown operation: ${request.operation}`);
      }

      // Write success response
      fs.writeFileSync(responseFile, JSON.stringify({
        request_id: request.request_id,
        status: 'success',
        timestamp: new Date().toISOString(),
        result
      }));

      // Log operation
      this.logOperation(request, 'success');

    } catch (error) {
      // Write error response
      fs.writeFileSync(responseFile, JSON.stringify({
        request_id: request.request_id,
        status: 'error',
        timestamp: new Date().toISOString(),
        error: {
          code: error.code || 'UNKNOWN_ERROR',
          message: error.message
        }
      }));

      // Log error
      this.logOperation(request, 'error', error.message);
    }

    // Clean up request file
    fs.unlinkSync(filepath);
  }

  validateRequest(request) {
    // Validate operation
    const allowedOps = ['create', 'read', 'diff', 'list', 'apply'];
    if (!allowedOps.includes(request.operation)) {
      throw { code: 'INVALID_OPERATION', message: 'Operation not allowed' };
    }

    // Validate file sizes
    if (request.operation === 'create') {
      for (const [filename, fileData] of Object.entries(request.params.files || {})) {
        const size = Buffer.byteLength(fileData.content, 'utf8');
        if (size > MAX_FILE_SIZE) {
          throw { code: 'FILE_TOO_LARGE', message: `File ${filename} exceeds 10 MB limit` };
        }
      }
    }

    // Additional validation rules...
  }

  checkRateLimit() {
    const now = Date.now();
    const hourAgo = now - (60 * 60 * 1000);

    // Clean old entries
    for (const [timestamp, count] of this.requestCounts.entries()) {
      if (timestamp < hourAgo) {
        this.requestCounts.delete(timestamp);
      }
    }

    // Count recent requests
    const recentCount = Array.from(this.requestCounts.values())
      .reduce((sum, count) => sum + count, 0);

    if (recentCount >= RATE_LIMIT) {
      throw {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Maximum ${RATE_LIMIT} gists per hour exceeded`
      };
    }

    // Record this request
    this.requestCounts.set(now, 1);
  }

  async createGist(params) {
    // Build gh api command
    const filesArg = Object.entries(params.files || {})
      .map(([name, data]) => `-f 'files[${name}][content]=${data.content}'`)
      .join(' ');

    const cmd = `gh api /gists -X POST \
      -f description="${params.description || 'Created by Andy'}" \
      -f public=${params.public || false} \
      ${filesArg}`;

    return new Promise((resolve, reject) => {
      exec(cmd, (error, stdout, stderr) => {
        if (error) {
          reject({ code: 'GITHUB_API_ERROR', message: stderr });
          return;
        }

        const response = JSON.parse(stdout);

        // Extract raw URLs
        const raw_urls = {};
        for (const [filename, fileData] of Object.entries(response.files)) {
          raw_urls[filename] = fileData.raw_url;
        }

        resolve({
          url: response.html_url,
          html_url: response.html_url,
          gist_id: response.id,
          raw_urls
        });
      });
    });
  }

  async readGist(params) {
    const cmd = `gh api /gists/${params.gist_id}`;

    return new Promise((resolve, reject) => {
      exec(cmd, (error, stdout, stderr) => {
        if (error) {
          reject({ code: 'GITHUB_API_ERROR', message: stderr });
          return;
        }

        const gist = JSON.parse(stdout);

        resolve({
          gist_id: gist.id,
          description: gist.description,
          url: gist.html_url,
          files: gist.files,
          created_at: gist.created_at,
          updated_at: gist.updated_at
        });
      });
    });
  }

  logOperation(request, status, error = null) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      request_id: request.request_id,
      operation: request.operation,
      status,
      error
    };

    fs.appendFileSync(
      '/workspace/ipc/gist_proxy.log',
      JSON.stringify(logEntry) + '\n'
    );
  }
}

// Start daemon
const proxy = new GistProxy();
proxy.start();
```

**Systemd Service:**
```ini
[Unit]
Description=Gist Proxy Daemon
After=network.target

[Service]
Type=simple
User=<host-user>
ExecStart=/usr/local/bin/gist-proxy-daemon
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Container-Side Gist CLI Tool

```bash
#!/bin/bash
# /usr/local/bin/gist

IPC_DIR="/workspace/ipc/gist_requests"
REQUEST_ID=$(date +%s%N)

# Ensure IPC directory exists
mkdir -p "$IPC_DIR"

case "$1" in
  create)
    FILE="$2"
    DESCRIPTION="${3:---description}"
    DESC_VALUE="$4"

    if [[ ! -f "$FILE" ]]; then
      echo "Error: File not found: $FILE" >&2
      exit 1
    fi

    # Read file content
    CONTENT=$(cat "$FILE")

    # Create request
    cat > "$IPC_DIR/create_${REQUEST_ID}.json" <<EOF
{
  "operation": "create",
  "request_id": "${REQUEST_ID}",
  "timestamp": "$(date -Iseconds)",
  "params": {
    "files": {
      "$(basename "$FILE")": {
        "content": $(echo "$CONTENT" | jq -Rs .)
      }
    },
    "description": "$DESC_VALUE",
    "public": false
  }
}
EOF

    # Wait for response (with timeout)
    RESPONSE_FILE="$IPC_DIR/create_${REQUEST_ID}.response.json"
    TIMEOUT=30
    ELAPSED=0

    while [[ ! -f "$RESPONSE_FILE" ]] && [[ $ELAPSED -lt $TIMEOUT ]]; do
      sleep 0.5
      ELAPSED=$((ELAPSED + 1))
    done

    if [[ ! -f "$RESPONSE_FILE" ]]; then
      echo "Error: Request timeout" >&2
      exit 1
    fi

    # Parse response
    RESPONSE=$(cat "$RESPONSE_FILE")
    rm "$RESPONSE_FILE"

    STATUS=$(echo "$RESPONSE" | jq -r '.status')

    if [[ "$STATUS" == "success" ]]; then
      URL=$(echo "$RESPONSE" | jq -r '.result.url')
      echo "$URL"
      exit 0
    else
      ERROR=$(echo "$RESPONSE" | jq -r '.error.message')
      echo "Error: $ERROR" >&2
      exit 1
    fi
    ;;

  read)
    GIST_ID="$2"

    cat > "$IPC_DIR/read_${REQUEST_ID}.json" <<EOF
{
  "operation": "read",
  "request_id": "${REQUEST_ID}",
  "timestamp": "$(date -Iseconds)",
  "params": {
    "gist_id": "$GIST_ID"
  }
}
EOF

    # Similar wait-for-response logic...
    # [implementation similar to create]
    ;;

  *)
    echo "Usage: gist <create|read|diff|apply|list> [options]" >&2
    exit 1
    ;;
esac
```

## Alternatives Considered

### 1. Upload to cloud storage (S3, GCS)
- **Pros:** No GitHub dependency
- **Cons:** Requires separate auth, storage management, expiration handling, no syntax highlighting
- **Rejected:** More complex, worse UX than GitHub's native file viewer

### 2. Paste to pastebin services (pastebin.com, paste.ee)
- **Pros:** Simple, no auth needed
- **Cons:** Public by default, ads, no multi-file support, poor reliability
- **Rejected:** Not private, unprofessional

### 3. Base64 encode and send via WhatsApp
- **Pros:** No external service
- **Cons:** Unreadable, hits message size limits, no syntax highlighting
- **Rejected:** Terrible UX

### 4. Write to shared Google Drive folder
- **Pros:** Integrated with Google ecosystem
- **Cons:** Requires separate OAuth, slower to access, no syntax highlighting
- **Rejected:** More friction than GitHub

### 5. Wait for WhatsApp media sending feature
- **Pros:** Native WhatsApp experience
- **Cons:** Limited to single files, no syntax highlighting, no collaborative editing
- **Rejected:** Complementary, not replacement (Gist is better for code/configs)

## Acceptance Criteria

### Host-Side Proxy
- [ ] Gist proxy daemon installed on host
- [ ] Systemd service configured and running
- [ ] IPC directory `/workspace/ipc/gist_requests/` created with correct permissions
- [ ] Proxy validates all operations against allowlist
- [ ] Rate limiting enforced (10 gists/hour default)
- [ ] File size validation (10 MB per file, 100 MB total)
- [ ] Audit logging to `/var/log/gist-proxy-audit.log`
- [ ] Uses host's `gh` authentication (user must be logged in on host)
- [ ] Error responses written to `.response.json` files
- [ ] Request cleanup (delete processed request files)
- [ ] Graceful handling of GitHub API errors
- [ ] Timeout handling for slow GitHub API calls

### Container-Side CLI Tool
- [ ] Custom `gist` CLI tool available at `/usr/local/bin/gist`
- [ ] `gist create <file>` command works
- [ ] `gist create-multi <dir>` for multiple files
- [ ] `gist read <gist_id>` command works
- [ ] `gist diff <gist_id>` command works
- [ ] `gist list` command works
- [ ] `gist apply <gist_id> <target>` command works
- [ ] Timeout handling (30 second default)
- [ ] Clear error messages for all failure modes
- [ ] No direct access to `gh` CLI in container
- [ ] No direct access to GitHub API from container

### MCP Tool Integration
- [ ] `mcp__nanoclaw__create_gist` tool available in container
- [ ] Tool calls `gist create` CLI under the hood
- [ ] Creates private gists by default
- [ ] Supports single-file gists
- [ ] Supports multi-file gists
- [ ] Returns shareable HTTPS URL
- [ ] Returns raw file URLs for direct download
- [ ] Optional description parameter
- [ ] Optional public flag (defaults to false)
- [ ] Error handling for proxy failures
- [ ] Error handling for rate limits
- [ ] Error handling for file size limits
- [ ] Fails gracefully with clear message if proxy is down

### Reading Gists
- [ ] `mcp__nanoclaw__read_gist` tool available
- [ ] Accepts gist ID or full URL
- [ ] Returns all files with content
- [ ] Optionally includes commit history
- [ ] Handles deleted/renamed files
- [ ] Returns timestamps (created, updated)

### Viewing Diffs
- [ ] `mcp__nanoclaw__get_gist_diff` tool available
- [ ] Shows changes between any two versions
- [ ] Returns unified diff format (patch)
- [ ] Shows per-file additions/deletions
- [ ] Includes full old/new content for each file
- [ ] Defaults to comparing previous commit to latest

### Applying Changes
- [ ] `mcp__nanoclaw__apply_gist_changes` tool available
- [ ] Downloads latest (or specific) version of gist
- [ ] Writes files to specified target directory
- [ ] Supports dry-run mode for preview
- [ ] Detects conflicts with existing files
- [ ] Can apply specific files only
- [ ] Returns list of applied/skipped/conflicted files

## Technical Notes

### Relevant Files

**Host-Side:**
- `/usr/local/bin/gist-proxy-daemon` - Proxy daemon (Node.js)
- `/etc/systemd/system/gist-proxy.service` - Systemd service
- `/etc/gist-proxy/config.yaml` - Configuration
- `/var/log/gist-proxy-audit.log` - Audit log
- `/workspace/ipc/gist_requests/` - IPC directory

**Container-Side:**
- `/usr/local/bin/gist` - Custom CLI tool (bash)
- MCP tool: `mcp__nanoclaw__create_gist` (calls `gist` CLI)
- MCP tool: `mcp__nanoclaw__read_gist`
- MCP tool: `mcp__nanoclaw__get_gist_diff`
- MCP tool: `mcp__nanoclaw__apply_gist_changes`

### Dependencies

**Host:**
- Node.js (for proxy daemon)
- `gh` CLI (authenticated with GitHub)
- `chokidar` npm package (file watching)
- `jq` (JSON parsing in bash)

**Container:**
- `bash` (for gist CLI tool)
- `jq` (JSON parsing)
- Standard UNIX tools (cat, date, mkdir)

### GitHub API Details

**Endpoint:** `POST /gists`

**Authentication:** Via host's `gh` CLI (user must run `gh auth login` on host)

**Rate Limits:**
- GitHub API: 5,000 requests/hour (authenticated)
- Host proxy: 10 gists/hour (configurable, default)
- Host limit applies first for security

**Gist Size Limits:**
- Single file: 100 MB (GitHub limit)
- Total gist: 100 MB (GitHub limit)
- Host enforces: 10 MB per file (configurable, more conservative)
- Large gists may be slow to render on GitHub

### Error Handling

```javascript
try {
  const gist = await createGist(params);
  return gist;
} catch (error) {
  if (error.status === 401) {
    throw new Error('GitHub authentication failed. Run `gh auth login` to authenticate.');
  } else if (error.status === 403) {
    throw new Error('GitHub API rate limit exceeded. Try again later.');
  } else if (error.status === 422) {
    throw new Error('Invalid gist content. Check file sizes and format.');
  } else {
    throw new Error(`GitHub API error: ${error.message}`);
  }
}
```

### Security Considerations

**Defense-in-Depth Approach:**

1. **Scoped Access (Primary Defense)**
   - Container has ZERO direct access to GitHub API
   - Custom `gist` CLI tool only allows gist operations
   - No access to repos, issues, PRs, Actions, or org management
   - Host proxy validates all operations before forwarding to GitHub

2. **Rate Limiting**
   - Host enforces 10 gists per hour limit
   - Prevents abuse or runaway scripts
   - Configurable per-user or per-group

3. **Size Limits**
   - 10 MB per file maximum
   - 100 MB total gist size (GitHub's limit)
   - Prevents resource exhaustion

4. **Validation & Sanitization**
   - Host validates all parameters before GitHub API calls
   - Filename sanitization (no path traversal)
   - Content validation (encoding, special characters)

5. **Audit Trail**
   - All gist operations logged on host
   - Timestamps, request IDs, operation types
   - Success/failure status for security review

6. **Data Privacy**
   - Gists are private by default
   - User's GitHub account controls access
   - Gist URLs are unguessable (long random IDs) but not encrypted
   - Sensitive data warning: Remind user that gists are stored on GitHub
   - Consider adding confirmation prompt for files containing secrets/keys

7. **Credential Isolation**
   - GitHub auth token NEVER exposed to container
   - Host proxy uses host-side `gh` authentication
   - Container cannot read or modify GitHub credentials

8. **Failure Safety**
   - If proxy daemon is down, operations fail gracefully
   - Clear error messages to user
   - No silent failures or data loss

**Security Benefits vs. Direct gh CLI Access:**

| Aspect | Direct `gh` CLI | Custom `gist` Tool |
|--------|-----------------|-------------------|
| **Scope** | Full GitHub API | Gist operations only |
| **Repos** | Full access | ❌ No access |
| **Issues/PRs** | Full access | ❌ No access |
| **Actions** | Full access | ❌ No access |
| **Rate Limiting** | GitHub's limits | Host-enforced limits |
| **Audit Trail** | GitHub audit log | Host + GitHub logs |
| **Credential Exposure** | In container | Host only |
| **Attack Surface** | Large | Minimal |

### Custom Gist CLI vs. GitHub CLI

The container uses a **custom `gist` command** instead of GitHub's `gh` CLI:

**What the container has:**
```bash
$ gist create config.yaml --description "My config"
$ gist read abc123def456
$ gist list
```

**What the container does NOT have:**
```bash
$ gh repo clone    # ❌ Not available
$ gh issue create  # ❌ Not available
$ gh pr create     # ❌ Not available
$ gh api /repos    # ❌ Not available
```

**Why This Matters:**

If the container had full `gh` CLI access:
- Could read/write any repo you have access to
- Could create/modify issues and pull requests
- Could trigger GitHub Actions workflows
- Could modify organization settings
- Complete GitHub account access from compromised container

With custom `gist` tool:
- Can ONLY create/read gists
- No repo access
- No issue/PR access
- No Actions access
- Minimal blast radius if container compromised

### Host Proxy Implementation Details

**Installation:**

1. Create proxy daemon: `/usr/local/bin/gist-proxy-daemon` (Node.js script above)
2. Create systemd service: `/etc/systemd/system/gist-proxy.service`
3. Enable and start:
   ```bash
   sudo systemctl enable gist-proxy
   sudo systemctl start gist-proxy
   ```

**Configuration:**

```yaml
# /etc/gist-proxy/config.yaml
rate_limits:
  gists_per_hour: 10
  max_file_size_mb: 10

security:
  allowed_operations:
    - create
    - read
    - diff
    - list
    - apply

  validation:
    max_files_per_gist: 50
    allowed_extensions: "*"  # or specific list

logging:
  audit_log: /var/log/gist-proxy-audit.log
  level: info
```

**Monitoring:**

```bash
# View recent gist operations
tail -f /var/log/gist-proxy-audit.log

# Check rate limits
gist-proxy-admin stats

# View active requests
ls /workspace/ipc/gist_requests/
```

**Troubleshooting:**

```bash
# Check proxy daemon status
systemctl status gist-proxy

# View logs
journalctl -u gist-proxy -f

# Test proxy manually
echo '{"operation":"list","request_id":"test"}' > /workspace/ipc/gist_requests/test.json
cat /workspace/ipc/gist_requests/test.response.json
```

## Use Cases Unlocked

1. **Code snippets** - User asks "show me that regex" → Andy creates gist with highlighted syntax
2. **Configuration files** - Andy generates nginx/docker config → Returns gist URL
3. **Scripts** - Andy writes bash/python script → User gets executable via raw URL
4. **Reports** - Andy creates markdown report → Rendered beautifully on GitHub
5. **Multi-file projects** - Andy scaffolds project structure → All files in one gist
6. **Logs/debug output** - Andy captures error logs → Shareable link instead of wall of text
7. **Data exports** - Andy exports CSV/JSON data → User downloads via raw URL
8. **Collaborative editing** - Andy creates gist → User edits on GitHub → Andy reads changes and applies locally
9. **Change review** - User modifies gist → Andy shows diff before applying
10. **Version tracking** - Andy can read gist history to see all changes over time
11. **Iterative refinement** - Andy creates v1 → User tweaks → Andy reads v2 → Andy creates v3 → cycle continues
12. **Conflict detection** - Andy detects if local file was modified since gist creation

## Integration with Media Sending

These features are complementary:

| Feature | Best For |
|---------|----------|
| **Gist** | Code, configs, text files, multi-file projects |
| **WhatsApp Media** (future) | Images, PDFs, screenshots, videos |

Gist advantages over media:
- Syntax highlighting
- Version history
- Collaborative editing (forks, comments)
- Embeddable in docs
- Raw download URLs

## Related

- Feature request: WhatsApp Media Sending (2026-03-03) - Complementary feature for images/PDFs
