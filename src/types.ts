/**
 * Core type definitions for the agent-rbac framework.
 */

// ── Permission Config ────────────────────────────────────────────

export interface PermissionConfig {
  owner: string;
  roles: Record<string, RoleDefinition>;
  users: Record<string, UserDefinition>;
  defaults: {
    unknownUserRole: string;
  };
  protectedPaths?: Record<string, string[]>;
}

export interface RoleDefinition {
  name: string;
  permissions: string[];
  deny?: string[];
  rateLimit?: number | null;
  maxMode?: string;
}

export interface UserDefinition {
  name: string;
  roles: string[];
  permissions?: string[];
  deny?: string[];
  rateLimit?: number | null;
}

// ── Resolved User ────────────────────────────────────────────────

export interface UserPermissions {
  userId: string;
  name: string;
  topRole: string;
  permissions: Set<string>;
  deny: Set<string>;
  rateLimit: number | null;
  maxMode: string;
}

// ── Config Loader ────────────────────────────────────────────────

export interface ConfigLoader {
  load(): PermissionConfig;
  save?(config: PermissionConfig): void;
}

// ── Mode Hierarchy ───────────────────────────────────────────────

export interface ModeHierarchy {
  levels: Record<string, number>;
}

// ── Command Mapping ──────────────────────────────────────────────

export interface CommandMapping {
  command: string;
  permission: string | null;
  /** If true, args are appended to permission string (e.g. /mode ask → bridge.mode.ask) */
  appendArgs?: boolean;
}

// ── Tool Interception ────────────────────────────────────────────

export interface ToolCallContext {
  toolName: string;
  filePaths?: string[];
  args?: Record<string, unknown>;
}

export interface ToolInterceptionResult {
  allowed: boolean;
  requiredPermission?: string;
  reason?: string;
}

// ── Rate Limiter ─────────────────────────────────────────────────

export interface RateBucket {
  timestamps: number[];
}

export interface RateLimiterStorage {
  get(userId: string): RateBucket | undefined;
  set(userId: string, bucket: RateBucket): void;
  delete(userId: string): void;
  entries(): IterableIterator<[string, RateBucket]>;
}

// ── Memory Store ─────────────────────────────────────────────────

export interface MemoryStore {
  read(userId: string, key: string): Promise<string | null>;
  write(userId: string, key: string, content: string): Promise<void>;
  delete(userId: string, key: string): Promise<boolean>;
  list(userId: string): Promise<string[]>;
  exists(userId: string, key: string): Promise<boolean>;
}

// ── Enforcement Pipeline ─────────────────────────────────────────

export interface EnforcementContext {
  userId: string;
  user: UserPermissions;
  config: PermissionConfig;
  /** Raw message or command text */
  input: string;
  /** Parsed command name, if applicable */
  command?: string;
  /** Parsed command arguments */
  commandArgs?: string;
  /** Current session mode */
  currentMode?: string;
  /** Tool call context, if this is a tool invocation */
  toolCall?: ToolCallContext;
}

export interface EnforcementResult {
  allowed: boolean;
  /** Which layer denied the request */
  deniedBy?: string;
  /** Human-friendly denial reason */
  reason?: string;
  /** Context modifications (e.g. injected prompts, loaded memory) */
  context?: Record<string, unknown>;
  /** Mode to enforce for this session */
  enforcedMode?: string;
}

export type EnforcementLayer = (
  ctx: EnforcementContext,
) => EnforcementResult | null;

// ── Permission Manager ───────────────────────────────────────────

export interface PermissionManagerOps {
  grant(userId: string, permissions: string[]): void;
  revoke(userId: string, permissions: string[]): void;
  assignRole(userId: string, role: string): void;
  removeRole(userId: string, role: string): void;
  setRateLimit(userId: string, limit: number | null): void;
}

// ── Adapter (for consumer integration) ───────────────────────────

export interface RbacAdapter {
  /** Extract file paths from a tool call for path-based permission checks */
  extractFilePaths?(toolCall: ToolCallContext): string[];
  /** Map a tool name to the required permission */
  mapToolPermission?(toolName: string): string | null;
  /** Expand ~ or env vars in paths */
  expandPath?(filePath: string): string;
}
