/**
 * Layer 5: Tool Interception — protected path matching + tool permission checks.
 */

import * as fs from 'node:fs';
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
import { formatReason } from '../core/messages.js';

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
        const expanded = patterns.map((p) => this.normalizePath(p));
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
    const normalized = this.normalizePath(filePath);
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
    const normalized = this.normalizePath(filePath);
    const results: string[] = [];
    for (const matcher of this.matchers) {
      if (matcher.isMatch(normalized)) {
        results.push(matcher.permission);
      }
    }
    return results;
  }

  normalizePath(p: string): string {
    const expanded = p.startsWith('~/')
      ? path.join(os.homedir(), p.slice(2))
      : p;
    const resolved = path.resolve(expanded);
    try {
      if (fs.existsSync(resolved)) {
        return fs.realpathSync.native(resolved);
      }
    } catch {
      // Fall back to resolved when realpath fails.
    }
    return resolved;
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
    locale?: string,
  ): ToolInterceptionResult {
    const matchedPermissions: string[] = [];
    const normalizedPaths = this.resolveFilePaths(toolCall);

    // Check tool-level permission via adapter
    if (this.adapter?.mapToolPermission) {
      const perm = this.adapter.mapToolPermission(toolCall.toolName);
      if (perm) matchedPermissions.push(perm);
      if (perm && !hasPermission(user, perm)) {
        return {
          allowed: false,
          requiredPermission: perm,
          code: 'tool.permission',
          reason: formatReason(
            'tool.permission',
            { tool: toolCall.toolName, permission: perm },
            locale,
          ),
          normalizedPaths,
          matchedPermissions,
        };
      }
    }

    // Check file path permissions
    if (this.pathMatcher) {
      for (const fp of normalizedPaths) {
        const requiredPerms = this.pathMatcher.matchAll(fp);
        matchedPermissions.push(...requiredPerms);
        const missing = requiredPerms.find((perm) => !hasPermission(user, perm));
        if (missing) {
          return {
            allowed: false,
            requiredPermission: missing,
            code: 'tool.path',
            reason: formatReason(
              'tool.path',
              { path: fp, permission: missing },
              locale,
            ),
            normalizedPaths,
            matchedPermissions,
          };
        }
      }
    }

    return {
      allowed: true,
      normalizedPaths,
      matchedPermissions,
    };
  }

  private resolveFilePaths(toolCall: ToolCallContext): string[] {
    // Use adapter to extract paths if available
    if (this.adapter?.extractFilePaths) {
      const paths = this.adapter.extractFilePaths(toolCall);
      return paths.map((p) =>
        this.normalizePath(
          this.adapter?.expandPath ? this.adapter.expandPath(p) : p,
        ),
      );
    }
    // Fall back to toolCall.filePaths
    if (toolCall.filePaths) {
      return toolCall.filePaths.map((p) => this.normalizePath(p));
    }
    return [];
  }

  private normalizePath(p: string): string {
    return this.pathMatcher?.normalizePath(p) ?? path.resolve(
      p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p,
    );
  }
}
