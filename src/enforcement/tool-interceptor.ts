/**
 * Layer 5: Tool Interception — protected path matching + tool permission checks.
 */

import picomatch from 'picomatch';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  PermissionConfig,
  UserPermissions,
  ToolCallContext,
  ToolInterceptionResult,
  RbacAdapter,
} from '../types.js';
import { hasPermission } from '../core/permission-resolver.js';

// ── Protected Path Matcher ───────────────────────────────────────

export class ProtectedPathMatcher {
  private matchers: Array<{
    permission: string;
    patterns: string[];
    isMatch: (path: string) => boolean;
  }> = [];

  constructor(protectedPaths: Record<string, string[]>) {
    const entries = Object.entries(protectedPaths).map(
      ([permission, patterns]) => {
        const expanded = patterns.map((p) => this.expandPath(p));
        return {
          permission,
          patterns: expanded,
          isMatch: picomatch(expanded),
        };
      },
    );
    // Sort by longest pattern first (more specific paths match before broader ones)
    entries.sort((a, b) => {
      const maxA = Math.max(...a.patterns.map((p) => p.length));
      const maxB = Math.max(...b.patterns.map((p) => p.length));
      return maxB - maxA;
    });
    this.matchers = entries;
  }

  /**
   * Match a file path against protected patterns.
   * Returns the required permission, or null if the path is not protected.
   */
  match(filePath: string): string | null {
    const normalized = this.expandPath(filePath);
    for (const matcher of this.matchers) {
      if (matcher.isMatch(normalized)) {
        return matcher.permission;
      }
    }
    return null;
  }

  /**
   * Match a file path and return all matching permissions.
   */
  matchAll(filePath: string): string[] {
    const normalized = this.expandPath(filePath);
    const results: string[] = [];
    for (const matcher of this.matchers) {
      if (matcher.isMatch(normalized)) {
        results.push(matcher.permission);
      }
    }
    return results;
  }

  private expandPath(p: string): string {
    if (p.startsWith('~/')) {
      return path.join(os.homedir(), p.slice(2));
    }
    return p;
  }
}

// ── Tool Interceptor ─────────────────────────────────────────────

export class ToolInterceptor {
  private readonly pathMatcher: ProtectedPathMatcher | null;
  private readonly adapter?: RbacAdapter;

  constructor(
    config: PermissionConfig,
    adapter?: RbacAdapter,
  ) {
    this.adapter = adapter;
    this.pathMatcher = config.protectedPaths
      ? new ProtectedPathMatcher(config.protectedPaths)
      : null;
  }

  /**
   * Check if a tool call is allowed for the given user.
   */
  check(
    user: UserPermissions,
    toolCall: ToolCallContext,
  ): ToolInterceptionResult {
    // Check tool-level permission via adapter
    if (this.adapter?.mapToolPermission) {
      const perm = this.adapter.mapToolPermission(toolCall.toolName);
      if (perm && !hasPermission(user, perm)) {
        return {
          allowed: false,
          requiredPermission: perm,
          reason: `Tool "${toolCall.toolName}" requires permission "${perm}"`,
        };
      }
    }

    // Check file path permissions
    if (this.pathMatcher) {
      const filePaths = this.resolveFilePaths(toolCall);
      for (const fp of filePaths) {
        const requiredPerm = this.pathMatcher.match(fp);
        if (requiredPerm && !hasPermission(user, requiredPerm)) {
          return {
            allowed: false,
            requiredPermission: requiredPerm,
            reason: `Access to path "${fp}" requires permission "${requiredPerm}"`,
          };
        }
      }
    }

    return { allowed: true };
  }

  private resolveFilePaths(toolCall: ToolCallContext): string[] {
    // Use adapter to extract paths if available
    if (this.adapter?.extractFilePaths) {
      const paths = this.adapter.extractFilePaths(toolCall);
      return paths.map((p) =>
        this.adapter?.expandPath ? this.adapter.expandPath(p) : this.expandDefault(p),
      );
    }
    // Fall back to toolCall.filePaths
    if (toolCall.filePaths) {
      return toolCall.filePaths.map((p) => this.expandDefault(p));
    }
    return [];
  }

  private expandDefault(p: string): string {
    if (p.startsWith('~/')) {
      return path.join(os.homedir(), p.slice(2));
    }
    return p;
  }
}
