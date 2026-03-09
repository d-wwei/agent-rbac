# Agent RBAC Framework — Design Specification

A role-based access control and memory isolation framework for multi-user AI agents.

## 1. Problem Statement

When an AI agent serves multiple users, it must:
- Restrict operations per user (who can read, write, execute)
- Protect information across users (no cross-user data leakage)
- Protect agent internals (memory, config, history) from unauthorized access
- Maintain per-user context and memory without cross-contamination
- Handle rejections naturally, not robotically
- Prevent resource abuse (rate limiting)

This framework provides a generic, implementation-agnostic design for solving these problems.

---

## 2. Core Concepts

| Concept | Definition |
|---|---|
| **Agent** | An AI system capable of multi-turn conversations with tool access |
| **User** | An entity identified by a unique ID who communicates with the agent |
| **Role** | A named collection of permissions and default configurations |
| **Permission** | A granular capability string representing an allowed action or access right |
| **Session** | A conversation context between one user and the agent |
| **Owner** | The agent's administrator with unrestricted access (`*`) |

---

## 3. Permission Model

### 3.1 Principles

- **Whitelist-only**: Users have no permissions by default. Every capability must be explicitly granted.
- **Owner exception**: The `*` wildcard grants all current and future permissions. Owner is never constrained by the permission list.
- **Deny override**: Explicit deny entries take absolute priority over any allow (from roles or direct grants).
- **Additive roles**: A user with multiple roles receives the union of all role permissions.

### 3.2 Permission Resolution Algorithm

```
function resolvePermissions(user):
  allowed = {}

  // Collect from all assigned roles
  for role in user.roles:
    allowed = allowed ∪ role.permissions

  // Add direct user permissions
  allowed = allowed ∪ user.permissions

  // Remove denied permissions (highest priority)
  allowed = allowed - user.deny

  return allowed

function hasPermission(user, requiredPermission):
  perms = resolvePermissions(user)
  if "*" in perms:
    return true
  if requiredPermission in user.deny:
    return false
  // Check exact match
  if requiredPermission in perms:
    return true
  // Check wildcard match (e.g. "bridge.*" covers "bridge.session.create")
  for p in perms:
    if p ends with ".*" and requiredPermission starts with prefix(p):
      return true
  return false
```

### 3.3 Wildcard Rules

- `*` — all permissions, unrestricted
- `category.*` — all permissions within a category (e.g. `bridge.*`, `claude.*`)
- Wildcards only apply at the dot-separated boundary

---

## 4. Permission Categories

### 4.1 Gateway Operations

Control what commands/actions the user can invoke at the agent's interface layer.

```
bridge.session.create        # Create new session
bridge.session.clear         # Clear/reset session
bridge.session.switch        # Switch between sessions
bridge.session.list          # List available sessions
bridge.mode.<mode>           # Use a specific agent mode (e.g. code, plan, ask)
bridge.workdir.change        # Change working directory
bridge.status                # View agent status
bridge.command.*             # All gateway commands
```

### 4.2 Agent Capability

Control what the agent can do within a session on behalf of the user.

```
agent.file.read              # Read files on host
agent.file.write             # Write/edit files
agent.file.delete            # Delete files
agent.bash.read              # Execute read-only shell commands
agent.bash.write             # Execute state-modifying shell commands
agent.git.read               # Git read operations (status, log, diff)
agent.git.write              # Git write operations (commit, push, branch)
agent.web.search             # Web search
agent.web.fetch              # Fetch web content
agent.tool.*                 # All tool/plugin usage
```

### 4.3 Information Access

Control what information the user can access about the agent and other entities.

```
info.agent.memory.read       # View agent's internal memory
info.agent.memory.write      # Modify agent's internal memory
info.agent.history.read      # View agent's session history
info.agent.projects.read     # View agent's project information
info.agent.config.read       # View agent configuration
info.agent.config.write      # Modify agent configuration
info.owner.identity.read     # Learn about the owner's identity
info.others.memory.read      # View other users' memory (owner-only)
info.public.memory.read      # Read public-facing knowledge base
info.public.memory.write     # Modify public knowledge base
info.own.memory.read         # View own user memory
```

### 4.4 Messaging

```
message.send                 # Basic ability to send messages to the agent
```

---

## 5. Role Definitions

### 5.1 Preset Roles

**owner**
```
permissions: ["*"]
defaultMode: most capable mode available
```

**member**
```
permissions:
  - message.send
  - bridge.session.create, bridge.session.clear, bridge.session.list
  - bridge.mode.plan, bridge.mode.ask
  - bridge.status
  - agent.file.read, agent.bash.read, agent.git.read
  - agent.web.search
  - info.public.memory.read, info.own.memory.read
defaultMode: plan (read-only)
```

**guest**
```
permissions:
  - message.send
  - bridge.mode.ask
  - bridge.status
  - info.public.memory.read, info.own.memory.read
defaultMode: ask (conversation only)
```

### 5.2 Custom Roles

Implementors can define arbitrary roles. A role is simply a name, a list of permissions, and optional default configuration (e.g. default mode).

---

## 6. Memory Architecture

### 6.1 Memory Layers

The agent's memory system has four isolation zones:

```
┌─────────────────────────────────────────────┐
│ Owner Memory (private)                      │
│  - Identity, preferences, workflows         │
│  - Project memory, session history          │
│  - Full agent context                       │
│  Only loaded in owner sessions              │
├─────────────────────────────────────────────┤
│ Public Memory (shared)                      │
│  - Interaction guidelines                   │
│  - Public knowledge base / FAQ              │
│  Loaded in all non-owner sessions           │
├─────────────────────────────────────────────┤
│ Per-User Memory (isolated per user)         │
│  - Global layer: profile, preferences,      │
│    long-term memory, session/project index  │
│  - Session layer: per-session notes         │
│  - Project layer: cross-session project     │
│    context                                  │
│  Only loaded in that user's sessions        │
├─────────────────────────────────────────────┤
│ Cross-User Access (owner only)              │
│  Owner can read/write any user's memory     │
│  No user can access another user's memory   │
└─────────────────────────────────────────────┘
```

### 6.2 Per-User Memory Structure

Each non-owner user has a layered memory system mirroring the owner's:

```
{user_memory_root}/{userId}/
  profile.md                  # Identity, background, department
  preferences.md              # Communication style, language, format
  memory.md                   # Long-term reusable knowledge
  sessions-index.md           # Index of all sessions and projects
  sessions/
    {sessionId}.md            # Per-session context and notes
  projects/
    {projectName}.md          # Cross-session project memory
```

### 6.3 Session Context Loading

| User type | Context loaded |
|---|---|
| Owner | Full agent memory (identity, projects, history, all internal state) |
| Non-owner | Public memory + own user memory (global + relevant session/project) |

**Critical**: Non-owner sessions never load owner memory, other users' memory, or agent internal configuration. The agent literally does not have this information in context — it cannot leak what it does not know.

### 6.4 Memory Write Timing

| Trigger | Action |
|---|---|
| Session end | Write `sessions/{sessionId}.md`, update `sessions-index.md` |
| Reusable info discovered | Write to `memory.md` |
| First interaction / identity change | Write to `profile.md`, `preferences.md` |
| Cross-session project emerges | Write to `projects/{name}.md` |

### 6.5 Cross-User Isolation

- User A's session loads: `public/*` + `users/{A}/**`
- User B's memory does not exist in User A's context
- Owner's session can load: everything including `users/{A}/**` and `users/{B}/**`
- If User A asks about User B, the agent cannot answer — the information is not in context

---

## 7. Enforcement Architecture

Permission enforcement is layered for defense in depth:

```
Message arrives
    │
    ▼
┌─────────────────────────────┐
│ Layer 1: Gateway            │  Rate limiting, basic auth
│ (before agent invocation)   │  Reject if rate-limited → fixed response, zero cost
│                             │  Check message.send permission
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Layer 2: Command Filter     │  Parse bridge commands (/mode, /new, etc.)
│ (before agent invocation)   │  Check command-specific permissions
│                             │  Reject unauthorized commands → soft response
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Layer 3: Context Isolation  │  Load memory based on user role
│ (session initialization)    │  Owner: full context
│                             │  Others: public + own memory only
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Layer 4: Capability Mode    │  Set agent mode based on permissions
│ (hard restriction)          │  code / plan / ask or equivalent
│                             │  Cannot be bypassed by user or agent
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Layer 5: Tool Interception  │  Intercept agent's tool/action requests
│ (fine-grained enforcement)  │  Check against user's agent.* permissions
│                             │  Auto-deny unauthorized tool calls
│                             │  Check protected paths for file access
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│ Layer 6: Prompt Guidance    │  Inject role and permission context
│ (defense in depth)          │  Agent aware of user's boundaries
│                             │  Natural, contextual responses
│                             │  Last line of defense, not primary
└─────────────────────────────┘
```

### 7.1 Protected Paths

Certain file paths require specific permissions beyond basic file read/write:

```json
{
  "info.agent.memory.read": ["~/.agent/memory/**", "~/.agent/global-*.md"],
  "info.agent.history.read": ["~/.agent/data/**", "~/.agent/runtime/**"],
  "info.agent.config.read": ["~/.agent/config.*", "~/.agent/permissions.json"],
  "info.owner.identity.read": ["~/.agent/global-user.md"],
  "info.others.memory.read": ["~/.agent/memory/users/**"]
}
```

When the agent attempts to read a file, the tool interception layer matches the path against protected patterns and checks whether the current user has the required permission.

### 7.2 Session Mode Consistency

On every incoming message:
1. Re-read permissions (hot-reload)
2. Determine the user's maximum allowed mode
3. If current session mode exceeds allowed mode → auto-downgrade and notify user

This ensures permission changes take effect immediately, even mid-session.

---

## 8. Rate Limiting

### 8.1 Mechanism

- Per-user sliding window counter
- Enforced at Layer 1 (gateway), before any agent invocation
- When limit is hit: respond with a short fixed message, zero agent cost

### 8.2 Configuration

Rate limits are configurable per role and can be overridden per user:

```json
{
  "rateLimit": {
    "guest":  { "maxPerHour": 20 },
    "member": { "maxPerHour": 100 },
    "owner":  null
  }
}
```

`null` means no rate limit.

Per-user override:
```json
{
  "users": {
    "user_123": {
      "rateLimit": { "maxPerHour": 50 }
    }
  }
}
```

User-level override takes precedence over role-level.

---

## 9. Rejection Handling

### 9.1 Principles

- Never use robotic "Access Denied" messages
- Be clear about what isn't available, without revealing why at a system level
- Provide alternatives when possible
- Do not reveal the permission system's internal structure

### 9.2 Rejection Sources

| Source | Handling |
|---|---|
| Rate limit exceeded | Gateway responds directly with short message. No agent invocation. |
| Unauthorized bridge command | Gateway responds with brief, natural explanation and suggests available alternatives. |
| Unauthorized tool call (Layer 5) | Agent receives a denial response and explains naturally in context. |
| Information access denied | Agent does not have the information in context, so it naturally cannot provide it. No explicit rejection needed. |

### 9.3 Tone

Rejections should feel like a helpful assistant explaining its boundaries:
- Not: "Error 403: Permission denied"
- Not: "You don't have the required bridge.mode.code permission"
- Instead: contextual, brief, suggests what the user can do

---

## 10. Configuration Schema

```json
{
  "roles": {
    "<roleName>": {
      "permissions": ["<permission>", ...],
      "defaultMode": "<mode>",
      "rateLimit": { "maxPerHour": <number> }
    }
  },
  "users": {
    "<userId>": {
      "name": "<displayName>",
      "roles": ["<roleName>", ...],
      "permissions": ["<permission>", ...],
      "deny": ["<permission>", ...],
      "rateLimit": { "maxPerHour": <number> }
    }
  },
  "defaults": {
    "unknownUserRole": "<roleName>",
    "rateLimit": {
      "<roleName>": { "maxPerHour": <number> }
    }
  },
  "protectedPaths": {
    "<permission>": ["<glob_pattern>", ...]
  }
}
```

### 10.1 Hot-Reload

The configuration file is read on every incoming message. No caching, no restart required. Permission changes take effect on the next message.

---

## 11. Implementation Guidelines

### 11.1 For Implementors

1. Map the permission categories to your agent's actual capabilities
2. Implement enforcement at each applicable layer
3. Design your memory file structure following the isolation model
4. Context loading logic must be role-aware from session creation
5. Protected paths should cover all sensitive files in your system
6. Test cross-user isolation by verifying one user cannot surface another user's data

### 11.2 Security Considerations

- Context isolation (Layer 3) is the primary defense against information leakage. If sensitive data is never loaded into context, it cannot be leaked regardless of prompt injection.
- Mode restriction (Layer 4) is the primary defense against unauthorized operations.
- Tool interception (Layer 5) provides fine-grained control within a mode.
- Prompt guidance (Layer 6) is defense in depth only — never rely on it as the sole protection.
- Rate limiting (Layer 1) protects against resource abuse and must be enforced before any agent computation.

### 11.3 Extensibility

- New permissions can be added at any time. Users with `*` automatically gain them.
- New roles can be defined without code changes.
- The protected paths mapping can be extended as new sensitive files are introduced.
- Per-user memory structure can be extended with new file types as needed.
