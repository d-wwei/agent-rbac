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
  AsyncEnforcementLayer,
  EnforcementTrace,
  PermissionManagerOps,
  RbacAdapter,
} from './types.js';
export type {
  HostIdentity,
  HostMessage,
  HostResourceRef,
  HostToolIntent,
  HostRequest,
  HostDecision,
  HostAdapter,
} from './host/types.js';
export type {
  DecisionRecord,
  DiffRecord,
  ReviewInput,
  TimelineFilter,
  HeatmapFilter,
  HeatmapResult,
  WeeklyReport,
} from './audit/types.js';
export type {
  AdaptiveObservation,
  AdaptiveUserProfile,
  AdaptiveOverlay,
  PolicySuggestion,
  FamiliaritySnapshot,
} from './adaptive/types.js';

// ── Config ───────────────────────────────────────────────────────
export { DEFAULT_CONFIG, DEFAULT_MODE_HIERARCHY } from './config/defaults.js';
export {
  FileConfigLoader,
  InMemoryConfigLoader,
  EnvConfigLoader,
} from './config/loader.js';
export {
  validateConfig,
  validateConfigSemantics,
  ConfigValidationError,
} from './config/schema.js';

// ── Core ─────────────────────────────────────────────────────────
export { resolveUser, hasPermission } from './core/permission-resolver.js';
export { formatReason } from './core/messages.js';
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
export {
  createContextLoaderLayer,
  createAsyncContextLoaderLayer,
} from './enforcement/context-loader.js';
export { createPromptBuilderLayer } from './enforcement/prompt-builder.js';
export { EnforcementPipeline } from './enforcement/pipeline.js';

// ── Memory ───────────────────────────────────────────────────────
export { FileSystemMemoryStore } from './memory/memory-store.js';
export { UserMemoryManager } from './memory/user-memory.js';

// ── Management ───────────────────────────────────────────────────
export { PermissionManager } from './management/grant-revoke.js';

// ── Host Contract ────────────────────────────────────────────────
export type {} from './host/types.js';

// ── Audit ────────────────────────────────────────────────────────
export { FileSystemAuditStore } from './audit/store.js';
export { AuditService } from './audit/service.js';

// ── Adaptive ─────────────────────────────────────────────────────
export { FileSystemAdaptiveStore } from './adaptive/store.js';
export { AdaptivePolicyCopilot } from './adaptive/service.js';

// ── Runtime ──────────────────────────────────────────────────────
export { AgentSecurityRuntime } from './runtime/security-runtime.js';

// ── Adapters ─────────────────────────────────────────────────────
export { OpenClawAdapter } from './adapters/openclaw.js';
export { ClaudeCodeAdapter } from './adapters/claude-code.js';
export { CodexAdapter } from './adapters/codex.js';
export { createHostPermissionAdapter } from './adapters/permission-mappers.js';

// ── OpenClaw Plugin ──────────────────────────────────────────────
export { default as OpenClawPlugin } from './openclaw-plugin.js';
