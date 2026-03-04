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

### Backend Implementation

Use GitHub REST API with user's authenticated session:

```javascript
const { Octokit } = require('@octokit/rest');

async function createGist(params) {
  // Use GitHub OAuth token from user's session
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN  // Or user's OAuth token
  });

  const response = await octokit.gists.create({
    files: params.files,
    description: params.description || 'Created by Andy',
    public: params.public || false
  });

  // Extract raw URLs for each file
  const raw_urls = {};
  for (const [filename, fileData] of Object.entries(response.data.files)) {
    raw_urls[filename] = fileData.raw_url;
  }

  return {
    url: response.data.html_url,
    html_url: response.data.html_url,
    raw_urls,
    gist_id: response.data.id
  };
}
```

### Authentication

Use GitHub CLI (`gh`) authentication which is already available in the container:

```bash
# Check if authenticated
gh auth status

# Use gh api to create gist
gh api /gists \
  -X POST \
  -f description="Created by Andy" \
  -f public=false \
  -f 'files[filename.txt][content]=file content here'
```

This leverages existing GitHub authentication without requiring new OAuth flows.

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

### Creating Gists
- [ ] `mcp__nanoclaw__create_gist` tool available in container
- [ ] Uses user's existing GitHub authentication (via `gh` CLI)
- [ ] Creates private gists by default
- [ ] Supports single-file gists
- [ ] Supports multi-file gists
- [ ] Returns shareable HTTPS URL
- [ ] Returns raw file URLs for direct download
- [ ] Optional description parameter
- [ ] Optional public flag (defaults to false)
- [ ] Error handling for auth failures
- [ ] Error handling for API rate limits
- [ ] Works when GitHub is authenticated via `gh auth login`
- [ ] Fails gracefully with clear message if not authenticated

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
- MCP tool registry (add `mcp__nanoclaw__create_gist`)
- GitHub integration module (new or extend existing)

### GitHub API Details

**Endpoint:** `POST /gists`

**Authentication:** Personal Access Token or OAuth

**Rate Limits:**
- Authenticated: 5,000 requests/hour
- Creating gists: Unlikely to hit limit in normal usage

**Gist Size Limits:**
- Single file: 100 MB
- Total gist: 100 MB
- Large gists may be slow to render

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

- Gists are private by default → user's GitHub account controls access
- Sensitive data warning: Remind user that gists are stored on GitHub
- Consider adding confirmation prompt for files containing secrets/keys
- Gist URLs are unguessable (long random IDs) but not encrypted
- User can delete gists manually from GitHub at any time

### GitHub CLI Integration

Container already has `gh` CLI available. Check authentication status:

```bash
gh auth status
# Returns: Logged in to github.com as username
```

Use `gh api` for all gist operations:

#### Create Gist
```bash
gh api /gists -X POST \
  -f description="My config" \
  -f public=false \
  -f 'files[config.json][content]={"key":"value"}'
# Returns JSON with html_url, id
```

#### Read Gist
```bash
gh api /gists/{gist_id}
# Returns JSON with files, description, created_at, updated_at, history array
```

#### Get Gist History
```bash
gh api /gists/{gist_id}/commits
# Returns array of commits with version SHA, committed_at, change_status
```

#### Get Specific Version
```bash
gh api /gists/{gist_id}/{sha}
# Returns gist content at specific commit
```

#### Download Raw File
```bash
curl -L {raw_url}
# Direct download of file content
```

This is simpler than managing Octokit dependencies and OAuth tokens.

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
