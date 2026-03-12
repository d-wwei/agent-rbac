# agent-rbac

Role-based access control and memory isolation framework for multi-user AI agents.

[中文文档](#中文文档) | [English](#english-documentation)

---

## Product Design Docs

- [Design Index](./docs/INDEX.md)
- [Product Architecture](./docs/ARCHITECTURE.md)
- [Policy Model Design](./docs/POLICY-MODEL.md)
- [Host Contract & Adapter Architecture](./docs/HOST-CONTRACT-AND-ADAPTERS.md)
- [Audit & Explainability](./docs/AUDIT-EXPLAINABILITY.md)
- [Adaptive Policy Copilot](./docs/ADAPTIVE-POLICY-COPILOT.md)
- [Data, Storage & Privacy](./docs/DATA-STORAGE-AND-PRIVACY.md)
- [Implementation Roadmap](./docs/IMPLEMENTATION-ROADMAP.md)

## Runtime Usage

Production usage is no longer limited to importing the library. The package now includes:

- host contract types
- file-backed audit storage
- adaptive policy copilot storage and services
- a production runtime orchestrator
- first-party OpenClaw, Claude Code, and Codex adapters
- an installable OpenClaw plugin package
- a CLI for evaluation, audit review, suggestions, and familiarity queries

### CLI Quick Start

```bash
npm install
npm run build
node dist/cli.js evaluate \
  --config ./examples/permissions.production.json \
  --state-dir ./.agent-rbac-state \
  --request ./examples/openclaw-request.json \
  --host openclaw

node dist/cli.js evaluate \
  --config ./examples/permissions.production.json \
  --state-dir ./.agent-rbac-state \
  --request ./examples/claude-code-request.json \
  --host claude-code

node dist/cli.js evaluate \
  --config ./examples/permissions.production.json \
  --state-dir ./.agent-rbac-state \
  --request ./examples/codex-request.json \
  --host codex
```

Useful commands:

```bash
node dist/cli.js audit timeline --state-dir ./.agent-rbac-state
node dist/cli.js suggestions --state-dir ./.agent-rbac-state --user alice
node dist/cli.js familiarity --state-dir ./.agent-rbac-state --user alice
```

### OpenClaw Plugin Install

Build the package, then install it into a local OpenClaw runtime with one command:

```bash
npm run build
node dist/cli.js openclaw install \
  --permissions-config ./examples/permissions.production.json \
  --state-dir ~/.openclaw/agent-rbac-state
```

This command:

- links the current package into OpenClaw via `openclaw plugins install --link`
- writes `plugins.entries.agent-rbac.config`
- enables internal hooks so prompt and tool guards can run

To exercise the installed plugin against a running gateway:

```bash
node dist/cli.js openclaw smoke \
  --url ws://127.0.0.1:19081 \
  --token dummy
```

## 中文文档

### 问题背景

当一个 AI Agent 同时服务多个用户时，需要解决：

- **操作隔离** — 不同用户能做的事不同（谁能读、写、执行）
- **信息隔离** — 用户之间的数据不能互相泄露
- **内部保护** — Agent 的配置、记忆、历史不被未授权访问
- **资源控制** — 防止滥用（限速）
- **自然拒绝** — 拒绝时像助手解释边界，而非机器人报错

`agent-rbac` 提供一套完整的六层防御架构来解决这些问题。

### 安装

```bash
npm install agent-rbac
```

要求 Node.js >= 20，ESM 模块。

说明：
- `Command Filter` 默认采用严格模式，未注册命令会被拒绝。
- 需要真实加载 memory 内容时，优先使用 `enforceAsync()`。

### 核心概念

| 概念 | 说明 |
|---|---|
| **Owner** | Agent 管理员，拥有 `*` 通配权限 |
| **Role** | 命名权限集合（如 guest、member、admin） |
| **Permission** | 粒度化的权限字符串（如 `bridge.session.create`、`agent.file.read`） |
| **Deny** | 显式拒绝，优先级高于任何允许 |

权限模型：白名单制 + Owner 例外 + Deny 覆盖 + 角色叠加

### 六层防御架构

```
消息进入
  │
  ├─ Layer 1: Gateway        限速 + message.send 检查
  ├─ Layer 2: Command Filter 命令权限（/mode、/new 等）
  ├─ Layer 3: Context Loader 按角色加载记忆（隔离）
  ├─ Layer 4: Capability Mode 模式限制（ask/plan/code）
  ├─ Layer 5: Tool Interceptor 工具拦截 + 路径保护
  └─ Layer 6: Prompt Builder  角色感知 prompt 注入
```

### 快速开始

#### 基础权限检查

```typescript
import { InMemoryConfigLoader, resolveUser, hasPermission } from 'agent-rbac';

const loader = new InMemoryConfigLoader({
  owner: 'owner_001',
  roles: {
    guest: { name: 'Guest', permissions: ['message.send'], rateLimit: 20, maxMode: 'ask' },
    member: { name: 'Member', permissions: ['message.send', 'bridge.*'], rateLimit: 60, maxMode: 'plan' },
  },
  users: { alice: { name: 'Alice', roles: ['member'] } },
  defaults: { unknownUserRole: 'guest' },
});

const config = loader.load();
const alice = resolveUser(config, 'alice');

hasPermission(alice, 'bridge.status');    // true（bridge.* 覆盖）
hasPermission(alice, 'agent.file.write'); // false
```

#### 完整管线

```typescript
import { EnforcementPipeline, FileConfigLoader, RateLimiter } from 'agent-rbac';

const pipeline = new EnforcementPipeline({
  configLoader: new FileConfigLoader('./permissions.json'),
  rateLimiter: new RateLimiter({ windowMs: 3600_000 }),
});

const result = await pipeline.enforceAsync({
  userId: 'alice',
  message: '/mode code',
  command: '/mode',
  commandArgs: 'code',
  currentMode: 'plan',
});

if (!result.allowed) {
  console.log(result.reason); // 自然语言拒绝，不暴露系统内部
}
```

#### 工具拦截 + 路径保护

```typescript
import { EnforcementPipeline, FileConfigLoader } from 'agent-rbac';
import type { RbacAdapter } from 'agent-rbac';

const adapter: RbacAdapter = {
  mapToolPermission: (tool) => ({ Bash: 'agent.bash.write', Read: 'agent.file.read' })[tool] ?? null,
  extractFilePaths: (tc) => tc.args?.file_path ? [tc.args.file_path as string] : [],
};

const pipeline = new EnforcementPipeline({
  configLoader: new FileConfigLoader('./permissions.json'),
  adapter,
});

// Agent 调用工具前检查
const result = pipeline.enforce({
  userId: 'guest_user',
  message: '',
  toolCall: { toolName: 'Read', args: { file_path: '~/.agent/permissions.json' } },
});
// result.allowed === false（guest 无 info.agent.config.read 权限）
```

#### 运行时权限管理

```typescript
import { PermissionManager, FileConfigLoader } from 'agent-rbac';

const manager = new PermissionManager(new FileConfigLoader('./permissions.json'));

manager.assignRole('bob', 'member');
manager.grant('bob', ['agent.web.search']);
manager.revoke('bob', ['agent.bash.write']);
manager.setRateLimit('bob', 100);
// 所有操作自动持久化到 permissions.json
```

#### 用户记忆隔离

```typescript
import { FileSystemMemoryStore, UserMemoryManager, resolveUser } from 'agent-rbac';

const store = new FileSystemMemoryStore('/data/user-memory');
const memory = new UserMemoryManager(store);

const owner = resolveUser(config, 'owner_001');
const alice = resolveUser(config, 'alice');

// 需要 info.own.memory.write 权限
await memory.writeProfile(alice, 'alice', '# Alice\nEngineer');
await memory.readProfile(alice, 'alice');  // "# Alice\nEngineer"
await memory.readProfile(alice, 'bob');    // null（隔离）
await memory.readProfile(owner, 'alice');  // "# Alice\nEngineer"（Owner 可读）
```

自己的 memory 权限已拆分为 `info.own.memory.read` / `info.own.memory.write`，
跨用户权限拆分为 `info.others.memory.read` / `info.others.memory.write`。

### 配置格式

```json
{
  "owner": "owner_user_id",
  "roles": {
    "guest": {
      "name": "Guest",
      "permissions": ["message.send"],
      "deny": [],
      "rateLimit": 20,
      "maxMode": "ask"
    },
    "member": {
      "name": "Member",
      "permissions": ["message.send", "bridge.status", "bridge.mode.ask", "bridge.mode.plan"],
      "rateLimit": 60,
      "maxMode": "plan"
    }
  },
  "users": {
    "user_123": {
      "name": "Alice",
      "roles": ["member"],
      "permissions": ["agent.file.read", "info.own.memory.write"],
      "deny": []
    }
  },
  "defaults": {
    "unknownUserRole": "guest"
  },
  "protectedPaths": {
    "info.agent.config.read": ["~/.agent/permissions.json"],
    "info.agent.memory.read": ["~/.agent/memory/**"]
  }
}
```

配置支持热重载 — 每次 `enforce()` 调用时重新读取，修改即时生效。

### 权限分类

| 分类 | 示例 | 说明 |
|---|---|---|
| Gateway | `bridge.session.create`, `bridge.mode.plan` | 控制接口层命令 |
| Agent Capability | `agent.file.read`, `agent.bash.write` | 控制 Agent 工具能力 |
| Information Access | `info.agent.memory.read`, `info.own.memory.read` | 控制信息可见性 |
| Messaging | `message.send` | 基本消息发送权限 |

通配符：`*`（全部）、`bridge.*`（分类通配）

### 新增能力

- `enforceAsync()`：异步执行完整管线，并真正加载 public / owner / user memory
- `trace`：每次 enforcement 返回可审计的 trace，包含层、角色、权限、模式等信息
- 配置语义校验：检查 default role、用户引用 role、`maxMode` 等问题
- 路径规范化：工具拦截会对路径做 `resolve/realpath` 规范化，减少绕过风险

---

## English Documentation

### Problem

When an AI agent serves multiple users simultaneously, it must:

- **Isolate operations** — different users have different capabilities
- **Isolate information** — no cross-user data leakage
- **Protect internals** — agent config, memory, history are not exposed
- **Control resources** — rate limiting to prevent abuse
- **Reject naturally** — denials feel like a helpful assistant explaining boundaries

`agent-rbac` provides a complete six-layer defense architecture for these problems.

### Installation

```bash
npm install agent-rbac
```

Requires Node.js >= 20, ESM only.

### Core Concepts

| Concept | Description |
|---|---|
| **Owner** | Agent administrator with `*` wildcard (unrestricted) |
| **Role** | Named permission set (e.g. guest, member, admin) |
| **Permission** | Granular capability string (e.g. `bridge.session.create`) |
| **Deny** | Explicit denial, takes absolute priority over any allow |

Permission model: whitelist-only + owner exception + deny override + additive roles.

### Six-Layer Enforcement

```
Message arrives
  │
  ├─ Layer 1: Gateway         Rate limiting + message.send check
  ├─ Layer 2: Command Filter  Command-specific permissions
  ├─ Layer 3: Context Loader  Role-based memory isolation
  ├─ Layer 4: Capability Mode Mode restriction (ask/plan/code)
  ├─ Layer 5: Tool Interceptor Tool + protected path enforcement
  └─ Layer 6: Prompt Builder   Role-aware prompt injection
```

### Quick Start

#### Basic Permission Check

```typescript
import { InMemoryConfigLoader, resolveUser, hasPermission } from 'agent-rbac';

const loader = new InMemoryConfigLoader({
  owner: 'owner_001',
  roles: {
    guest: { name: 'Guest', permissions: ['message.send'], rateLimit: 20, maxMode: 'ask' },
    member: { name: 'Member', permissions: ['message.send', 'bridge.*'], rateLimit: 60, maxMode: 'plan' },
  },
  users: { alice: { name: 'Alice', roles: ['member'] } },
  defaults: { unknownUserRole: 'guest' },
});

const config = loader.load();
const alice = resolveUser(config, 'alice');

hasPermission(alice, 'bridge.status');    // true (bridge.* wildcard)
hasPermission(alice, 'agent.file.write'); // false
```

#### Full Enforcement Pipeline

```typescript
import { EnforcementPipeline, FileConfigLoader, RateLimiter } from 'agent-rbac';

const pipeline = new EnforcementPipeline({
  configLoader: new FileConfigLoader('./permissions.json'),
  rateLimiter: new RateLimiter({ windowMs: 3600_000 }),
});

const result = pipeline.enforce({
  userId: 'alice',
  message: '/mode code',
  command: '/mode',
  commandArgs: 'code',
  currentMode: 'plan',
});

if (!result.allowed) {
  console.log(result.reason); // Natural language denial
}
```

#### Tool Interception with Protected Paths

```typescript
import { EnforcementPipeline, FileConfigLoader } from 'agent-rbac';
import type { RbacAdapter } from 'agent-rbac';

const adapter: RbacAdapter = {
  mapToolPermission: (tool) => ({ Bash: 'agent.bash.write', Read: 'agent.file.read' })[tool] ?? null,
  extractFilePaths: (tc) => tc.args?.file_path ? [tc.args.file_path as string] : [],
};

const pipeline = new EnforcementPipeline({
  configLoader: new FileConfigLoader('./permissions.json'),
  adapter,
});

const result = pipeline.enforce({
  userId: 'guest_user',
  message: '',
  toolCall: { toolName: 'Read', args: { file_path: '~/.agent/permissions.json' } },
});
// result.allowed === false (guest lacks info.agent.config.read)
```

#### Runtime Permission Management

```typescript
import { PermissionManager, FileConfigLoader } from 'agent-rbac';

const manager = new PermissionManager(new FileConfigLoader('./permissions.json'));

manager.assignRole('bob', 'member');
manager.grant('bob', ['agent.web.search']);
manager.revoke('bob', ['agent.bash.write']);
manager.setRateLimit('bob', 100);
// All changes auto-persisted to permissions.json
```

#### Per-User Memory Isolation

```typescript
import { FileSystemMemoryStore, UserMemoryManager, resolveUser } from 'agent-rbac';

const store = new FileSystemMemoryStore('/data/user-memory');
const memory = new UserMemoryManager(store);

const owner = resolveUser(config, 'owner_001');
const alice = resolveUser(config, 'alice');

await memory.writeProfile(alice, 'alice', '# Alice\nEngineer');
await memory.readProfile(alice, 'alice');  // "# Alice\nEngineer"
await memory.readProfile(alice, 'bob');    // null (isolated)
await memory.readProfile(owner, 'alice');  // "# Alice\nEngineer" (owner access)
```

### Configuration

```json
{
  "owner": "owner_user_id",
  "roles": {
    "guest": {
      "name": "Guest",
      "permissions": ["message.send"],
      "rateLimit": 20,
      "maxMode": "ask"
    }
  },
  "users": {},
  "defaults": { "unknownUserRole": "guest" },
  "protectedPaths": {
    "info.agent.config.read": ["~/.agent/permissions.json"]
  }
}
```

Config supports hot-reload — re-read on every `enforce()` call, changes take effect immediately.

### Permission Categories

| Category | Examples | Purpose |
|---|---|---|
| Gateway | `bridge.session.create`, `bridge.mode.plan` | Interface-layer commands |
| Agent Capability | `agent.file.read`, `agent.bash.write` | Agent tool capabilities |
| Information Access | `info.agent.memory.read`, `info.own.memory.read` | Information visibility |
| Messaging | `message.send` | Basic message permission |

Wildcards: `*` (everything), `bridge.*` (category wildcard).

### API Reference

#### Config Loaders

| Class | Description |
|---|---|
| `FileConfigLoader(path, envVar?)` | File-based with hot-reload, 3-tier owner recovery |
| `InMemoryConfigLoader(config)` | In-memory for testing |
| `EnvConfigLoader(envVar?)` | Locates config via environment variable |

#### Core Functions

| Function | Signature |
|---|---|
| `resolveUser` | `(config, userId, hierarchy?) → UserPermissions` |
| `hasPermission` | `(user, permission) → boolean` |
| `getMaxAllowedMode` | `(user, hierarchy?) → string` |
| `modeExceedsAllowed` | `(current, max, hierarchy?) → boolean` |

#### Classes

| Class | Purpose |
|---|---|
| `EnforcementPipeline` | Orchestrates all 6 layers |
| `RateLimiter` | Sliding window rate limiter with pluggable storage |
| `CommandMapper` | Registerable command → permission mapping |
| `ProtectedPathMatcher` | Glob-based path protection via picomatch |
| `ToolInterceptor` | Tool call permission enforcement |
| `UserMemoryManager` | Per-user memory with isolation guarantee |
| `PermissionManager` | Runtime grant/revoke/role management |
| `FileSystemMemoryStore` | File-based memory storage |

### Architecture

See [DESIGN.md](./DESIGN.md) for the full specification.

### Development

```bash
npm install
npm test          # Run 101 tests
npm run typecheck  # TypeScript type check
npm run build      # Build to dist/
```

### License

MIT
