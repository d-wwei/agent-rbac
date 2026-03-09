import { describe, it, expect } from 'vitest';
import { resolveUser, hasPermission } from '../core/permission-resolver.js';
import type { PermissionConfig, ModeHierarchy } from '../types.js';

const baseConfig: PermissionConfig = {
  owner: 'owner_001',
  roles: {
    guest: {
      name: 'Guest',
      permissions: ['message.send'],
      deny: [],
      rateLimit: 20,
      maxMode: 'ask',
    },
    member: {
      name: 'Member',
      permissions: [
        'message.send',
        'bridge.status',
        'bridge.mode.ask',
        'bridge.mode.plan',
        'bridge.session.list',
      ],
      deny: [],
      rateLimit: 60,
      maxMode: 'plan',
    },
    admin: {
      name: 'Admin',
      permissions: ['message.send', 'bridge.*'],
      deny: [],
      rateLimit: null,
      maxMode: 'code',
    },
  },
  users: {
    user_member: {
      name: 'Alice',
      roles: ['member'],
    },
    user_admin: {
      name: 'Bob',
      roles: ['admin'],
    },
    user_multi: {
      name: 'Charlie',
      roles: ['guest', 'member'],
    },
    user_custom: {
      name: 'Dave',
      roles: ['guest'],
      permissions: ['agent.file.read'],
      deny: ['message.send'],
    },
  },
  defaults: { unknownUserRole: 'guest' },
};

describe('resolveUser', () => {
  it('grants owner wildcard permissions', () => {
    const user = resolveUser(baseConfig, 'owner_001');
    expect(user.topRole).toBe('owner');
    expect(user.permissions.has('*')).toBe(true);
    expect(user.rateLimit).toBeNull();
    expect(user.maxMode).toBe('code');
  });

  it('resolves named user with member role', () => {
    const user = resolveUser(baseConfig, 'user_member');
    expect(user.name).toBe('Alice');
    expect(user.topRole).toBe('member');
    expect(user.permissions.has('message.send')).toBe(true);
    expect(user.permissions.has('bridge.status')).toBe(true);
    expect(user.rateLimit).toBe(60);
    expect(user.maxMode).toBe('plan');
  });

  it('falls back to default role for unknown users', () => {
    const user = resolveUser(baseConfig, 'unknown_user_xyz');
    expect(user.name).toBe('unknown');
    expect(user.topRole).toBe('guest');
    expect(user.permissions.has('message.send')).toBe(true);
    expect(user.rateLimit).toBe(20);
    expect(user.maxMode).toBe('ask');
  });

  it('merges permissions from multiple roles (additive)', () => {
    const user = resolveUser(baseConfig, 'user_multi');
    // Has both guest and member permissions
    expect(user.permissions.has('message.send')).toBe(true);
    expect(user.permissions.has('bridge.status')).toBe(true);
    expect(user.permissions.has('bridge.mode.plan')).toBe(true);
    // Takes highest rate limit
    expect(user.rateLimit).toBe(60);
    // Takes highest mode
    expect(user.maxMode).toBe('plan');
  });

  it('applies direct user permissions and deny overrides', () => {
    const user = resolveUser(baseConfig, 'user_custom');
    // Direct permission added
    expect(user.permissions.has('agent.file.read')).toBe(true);
    // message.send was denied — removed from permissions
    expect(user.permissions.has('message.send')).toBe(false);
    expect(user.deny.has('message.send')).toBe(true);
  });

  it('uses custom mode hierarchy', () => {
    const customHierarchy: ModeHierarchy = {
      levels: { read: 1, write: 2, admin: 3 },
    };
    const config: PermissionConfig = {
      ...baseConfig,
      roles: {
        ...baseConfig.roles,
        writer: {
          name: 'Writer',
          permissions: ['message.send'],
          maxMode: 'write',
          rateLimit: 50,
        },
      },
      users: {
        user_w: { name: 'Eve', roles: ['writer'] },
      },
    };
    const user = resolveUser(config, 'user_w', customHierarchy);
    expect(user.maxMode).toBe('write');
  });
});

describe('hasPermission', () => {
  it('returns true for owner wildcard', () => {
    const owner = resolveUser(baseConfig, 'owner_001');
    expect(hasPermission(owner, 'anything.at.all')).toBe(true);
  });

  it('returns true for exact match', () => {
    const user = resolveUser(baseConfig, 'user_member');
    expect(hasPermission(user, 'message.send')).toBe(true);
    expect(hasPermission(user, 'bridge.status')).toBe(true);
  });

  it('returns false for missing permission', () => {
    const user = resolveUser(baseConfig, 'user_member');
    expect(hasPermission(user, 'agent.file.write')).toBe(false);
  });

  it('matches wildcard prefixes (bridge.* covers bridge.session.create)', () => {
    const admin = resolveUser(baseConfig, 'user_admin');
    expect(hasPermission(admin, 'bridge.session.create')).toBe(true);
    expect(hasPermission(admin, 'bridge.mode.code')).toBe(true);
    expect(hasPermission(admin, 'bridge.anything.nested')).toBe(true);
    // Does not match non-bridge permissions
    expect(hasPermission(admin, 'agent.file.read')).toBe(false);
  });

  it('deny overrides allow', () => {
    const user = resolveUser(baseConfig, 'user_custom');
    expect(hasPermission(user, 'message.send')).toBe(false);
  });

  it('deny takes precedence even with wildcard in permissions', () => {
    const config: PermissionConfig = {
      ...baseConfig,
      roles: {
        ...baseConfig.roles,
        partial_admin: {
          name: 'Partial Admin',
          permissions: ['bridge.*'],
          deny: ['bridge.session.create'],
          maxMode: 'code',
        },
      },
      users: {
        user_pa: { name: 'PA', roles: ['partial_admin'] },
      },
    };
    const user = resolveUser(config, 'user_pa');
    // bridge.* minus bridge.session.create
    expect(hasPermission(user, 'bridge.status')).toBe(true);
    // deny removes exact match from permissions set, but wildcard still matches
    // Actually deny check in hasPermission is on exact match of the permission being checked
    // The deny set still contains bridge.session.create
    // But since it was removed from permissions via the deny subtract loop,
    // and bridge.* is still in permissions, the wildcard check would still match.
    // This is correct per design: deny only removes exact entries from the granted set,
    // but the deny check in hasPermission prevents the wildcard from covering it.
    expect(hasPermission(user, 'bridge.session.create')).toBe(false);
  });
});
