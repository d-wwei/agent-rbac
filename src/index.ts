/**
 * agent-rbac — Role-based access control and memory isolation for multi-user AI agents.
 *
 * @module agent-rbac
 */

// ── Types ────────────────────────────────────────────────────────
export type {
  PermissionConfig,
  RoleDefinition,
  UserDefinition,
  UserPermissions,
  ConfigLoader,
  ModeHierarchy,
  CommandMapping,
  ToolCallContext,
  ToolInterceptionResult,
  RateBucket,
  RateLimiterStorage,
  MemoryStore,
  EnforcementContext,
  EnforcementResult,
  EnforcementLayer,
  PermissionManagerOps,
  RbacAdapter,
} from './types.js';

// ── Config ───────────────────────────────────────────────────────
export { DEFAULT_CONFIG, DEFAULT_MODE_HIERARCHY } from './config/defaults.js';
export {
  FileConfigLoader,
  InMemoryConfigLoader,
  EnvConfigLoader,
} from './config/loader.js';
export { validateConfig, ConfigValidationError } from './config/schema.js';

// ── Core ─────────────────────────────────────────────────────────
export { resolveUser, hasPermission } from './core/permission-resolver.js';
export {
  RateLimiter,
  InMemoryRateLimiterStorage,
} from './core/rate-limiter.js';
export {
  createModeHierarchy,
  getMaxAllowedMode,
  modeExceedsAllowed,
  getModeLevel,
} from './core/mode-hierarchy.js';
export { CommandMapper } from './core/command-mapper.js';

// ── Enforcement ──────────────────────────────────────────────────
export {
  ProtectedPathMatcher,
  ToolInterceptor,
} from './enforcement/tool-interceptor.js';
export { createGatewayLayer } from './enforcement/gateway.js';
export { createCommandFilterLayer } from './enforcement/command-filter.js';
export { createCapabilityModeLayer } from './enforcement/capability-mode.js';
export { createContextLoaderLayer } from './enforcement/context-loader.js';
export { createPromptBuilderLayer } from './enforcement/prompt-builder.js';
export { EnforcementPipeline } from './enforcement/pipeline.js';

// ── Memory ───────────────────────────────────────────────────────
export { FileSystemMemoryStore } from './memory/memory-store.js';
export { UserMemoryManager } from './memory/user-memory.js';

// ── Management ───────────────────────────────────────────────────
export { PermissionManager } from './management/grant-revoke.js';
