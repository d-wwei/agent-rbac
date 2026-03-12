import { describe, it, expect } from 'vitest';
import { ProtectedPathMatcher, ToolInterceptor } from '../enforcement/tool-interceptor.js';
import { resolveUser } from '../core/permission-resolver.js';
import type { PermissionConfig, RbacAdapter } from '../types.js';
import * as os from 'node:os';
import * as path from 'node:path';

const home = os.homedir();

// ── ProtectedPathMatcher ─────────────────────────────────────────

describe('ProtectedPathMatcher', () => {
  const matcher = new ProtectedPathMatcher({
    'info.agent.memory.read': ['~/.agent/memory/**', '~/.agent/global-*.md'],
    'info.agent.config.read': ['~/.agent/config.*', '~/.agent/permissions.json'],
    'info.owner.identity.read': ['~/.agent/global-user.md'],
    'info.others.memory.read': ['~/.agent/memory/users/**'],
  });

  it('matches exact file path with ~ expansion', () => {
    const result = matcher.match(`${home}/.agent/permissions.json`);
    expect(result).toBe('info.agent.config.read');
  });

  it('matches glob patterns (double star)', () => {
    const result = matcher.match(`${home}/.agent/memory/daily/2026-03-09.md`);
    expect(result).toBe('info.agent.memory.read');
  });

  it('matches glob with wildcard (global-*.md)', () => {
    const result = matcher.match(`${home}/.agent/global-style.md`);
    expect(result).toBe('info.agent.memory.read');
  });

  it('matches tilde paths directly', () => {
    // global-user.md matches the more specific info.owner.identity.read pattern first
    const result = matcher.match('~/.agent/global-user.md');
    expect(result).toBe('info.owner.identity.read');

    // global-style.md only matches the broader global-*.md pattern
    const result2 = matcher.match('~/.agent/global-style.md');
    expect(result2).toBe('info.agent.memory.read');
  });

  it('returns null for non-protected paths', () => {
    const result = matcher.match('/tmp/random-file.txt');
    expect(result).toBeNull();
  });

  it('matchAll returns all matching permissions', () => {
    // global-user.md matches both agent.memory.read (via global-*.md) and owner.identity.read
    const results = matcher.matchAll(`${home}/.agent/global-user.md`);
    expect(results).toContain('info.agent.memory.read');
    expect(results).toContain('info.owner.identity.read');
  });

  it('matches nested paths under users/**', () => {
    const result = matcher.match(`${home}/.agent/memory/users/alice/profile.md`);
    expect(result).toBe('info.others.memory.read');
  });
});

// ── ToolInterceptor ──────────────────────────────────────────────

describe('ToolInterceptor', () => {
  const config: PermissionConfig = {
    owner: 'owner_001',
    roles: {
      guest: {
        name: 'Guest',
        permissions: ['message.send'],
        rateLimit: 20,
        maxMode: 'ask',
      },
      member: {
        name: 'Member',
        permissions: [
          'message.send',
          'agent.file.read',
          'info.public.memory.read',
          'info.own.memory.read',
        ],
        rateLimit: 60,
        maxMode: 'plan',
      },
    },
    users: {
      user_m: { name: 'Alice', roles: ['member'] },
    },
    defaults: { unknownUserRole: 'guest' },
    protectedPaths: {
      'info.agent.memory.read': ['~/.agent/memory/**'],
      'info.agent.config.read': ['~/.agent/permissions.json'],
      'info.others.memory.read': ['~/.agent/memory/users/**'],
    },
  };

  it('allows tool calls with no path restrictions', () => {
    const interceptor = new ToolInterceptor(config);
    const user = resolveUser(config, 'user_m');
    const result = interceptor.check(user, {
      toolName: 'Read',
      filePaths: ['/tmp/safe-file.txt'],
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks access to protected paths without permission', () => {
    const interceptor = new ToolInterceptor(config);
    const user = resolveUser(config, 'user_m');
    const result = interceptor.check(user, {
      toolName: 'Read',
      filePaths: [`${home}/.agent/permissions.json`],
    });
    expect(result.allowed).toBe(false);
    expect(result.requiredPermission).toBe('info.agent.config.read');
    expect(result.normalizedPaths).toContain(path.resolve(`${home}/.agent/permissions.json`));
  });

  it('allows owner to access any protected path', () => {
    const interceptor = new ToolInterceptor(config);
    const owner = resolveUser(config, 'owner_001');
    const result = interceptor.check(owner, {
      toolName: 'Read',
      filePaths: [`${home}/.agent/permissions.json`],
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks cross-user memory access for non-owner', () => {
    const interceptor = new ToolInterceptor(config);
    const user = resolveUser(config, 'user_m');
    const result = interceptor.check(user, {
      toolName: 'Read',
      filePaths: [`${home}/.agent/memory/users/other_user/profile.md`],
    });
    expect(result.allowed).toBe(false);
    expect(result.requiredPermission).toBe('info.others.memory.read');
  });

  it('uses adapter.mapToolPermission for tool-level checks', () => {
    const adapter: RbacAdapter = {
      mapToolPermission(toolName: string) {
        if (toolName === 'Bash') return 'agent.bash.write';
        return null;
      },
    };
    const interceptor = new ToolInterceptor(config, adapter);
    const user = resolveUser(config, 'user_m');

    // Member doesn't have agent.bash.write
    const result = interceptor.check(user, { toolName: 'Bash' });
    expect(result.allowed).toBe(false);
    expect(result.requiredPermission).toBe('agent.bash.write');
  });

  it('uses adapter.extractFilePaths to resolve paths from tool calls', () => {
    const adapter: RbacAdapter = {
      extractFilePaths(toolCall) {
        if (toolCall.args && typeof toolCall.args.file_path === 'string') {
          return [toolCall.args.file_path];
        }
        return [];
      },
    };
    const interceptor = new ToolInterceptor(config, adapter);
    const user = resolveUser(config, 'user_m');

    const result = interceptor.check(user, {
      toolName: 'Read',
      args: { file_path: `${home}/.agent/memory/daily/today.md` },
    });
    expect(result.allowed).toBe(false);
  });

  it('normalizes relative paths before matching protected rules', () => {
    const interceptor = new ToolInterceptor(config);
    const user = resolveUser(config, 'user_m');
    const relative = path.join(home, '.agent', 'folder', '..', 'permissions.json');
    const result = interceptor.check(user, {
      toolName: 'Read',
      filePaths: [relative],
    });
    expect(result.allowed).toBe(false);
    expect(result.requiredPermission).toBe('info.agent.config.read');
  });

  it('works without protectedPaths config', () => {
    const configNoPaths: PermissionConfig = {
      ...config,
      protectedPaths: undefined,
    };
    const interceptor = new ToolInterceptor(configNoPaths);
    const user = resolveUser(configNoPaths, 'user_m');
    const result = interceptor.check(user, {
      toolName: 'Read',
      filePaths: [`${home}/.agent/permissions.json`],
    });
    expect(result.allowed).toBe(true);
  });
});
