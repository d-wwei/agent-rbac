import { describe, it, expect, beforeEach } from 'vitest';
import { PermissionManager } from '../management/grant-revoke.js';
import { InMemoryConfigLoader } from '../config/loader.js';
import { resolveUser, hasPermission } from '../core/permission-resolver.js';
import type { PermissionConfig } from '../types.js';

const baseConfig: PermissionConfig = {
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
        'bridge.status',
        'bridge.mode.ask',
        'bridge.mode.plan',
      ],
      rateLimit: 60,
      maxMode: 'plan',
    },
    admin: {
      name: 'Admin',
      permissions: ['message.send', 'bridge.*'],
      rateLimit: null,
      maxMode: 'code',
    },
  },
  users: {
    user_a: { name: 'Alice', roles: ['guest'] },
  },
  defaults: { unknownUserRole: 'guest' },
};

describe('PermissionManager', () => {
  let loader: InMemoryConfigLoader;
  let manager: PermissionManager;

  beforeEach(() => {
    loader = new InMemoryConfigLoader(structuredClone(baseConfig));
    manager = new PermissionManager(loader);
  });

  // ── grant ─────────────────────────────────────────────────────

  it('grants permissions to existing user', () => {
    manager.grant('user_a', ['agent.file.read', 'agent.web.search']);
    const config = manager.getConfig();
    expect(config.users.user_a.permissions).toContain('agent.file.read');
    expect(config.users.user_a.permissions).toContain('agent.web.search');

    // Verify resolve picks them up
    const user = resolveUser(config, 'user_a');
    expect(hasPermission(user, 'agent.file.read')).toBe(true);
  });

  it('grants permissions to new user (auto-creates entry)', () => {
    manager.grant('new_user', ['bridge.status']);
    const config = manager.getConfig();
    expect(config.users.new_user).toBeDefined();
    expect(config.users.new_user.name).toBe('unknown');
    expect(config.users.new_user.permissions).toContain('bridge.status');
  });

  it('grant is idempotent', () => {
    manager.grant('user_a', ['agent.file.read']);
    manager.grant('user_a', ['agent.file.read']);
    const perms = manager.getConfig().users.user_a.permissions!;
    expect(perms.filter((p) => p === 'agent.file.read')).toHaveLength(1);
  });

  // ── revoke ────────────────────────────────────────────────────

  it('revokes permissions by adding to deny list', () => {
    manager.revoke('user_a', ['message.send']);
    const config = manager.getConfig();
    expect(config.users.user_a.deny).toContain('message.send');

    const user = resolveUser(config, 'user_a');
    expect(hasPermission(user, 'message.send')).toBe(false);
  });

  it('revoke removes from direct permissions too', () => {
    manager.grant('user_a', ['agent.file.read']);
    manager.revoke('user_a', ['agent.file.read']);
    const config = manager.getConfig();
    expect(config.users.user_a.permissions).not.toContain('agent.file.read');
    expect(config.users.user_a.deny).toContain('agent.file.read');
  });

  // ── assignRole ────────────────────────────────────────────────

  it('assigns a role to a user', () => {
    manager.assignRole('user_a', 'member');
    const config = manager.getConfig();
    expect(config.users.user_a.roles).toContain('member');

    const user = resolveUser(config, 'user_a');
    expect(hasPermission(user, 'bridge.status')).toBe(true);
  });

  it('assignRole is idempotent', () => {
    manager.assignRole('user_a', 'member');
    manager.assignRole('user_a', 'member');
    expect(
      manager.getConfig().users.user_a.roles.filter((r) => r === 'member'),
    ).toHaveLength(1);
  });

  it('assignRole throws for non-existent role', () => {
    expect(() => manager.assignRole('user_a', 'nonexistent')).toThrow(
      'does not exist',
    );
  });

  // ── removeRole ────────────────────────────────────────────────

  it('removes a role from a user', () => {
    manager.assignRole('user_a', 'member');
    manager.removeRole('user_a', 'member');
    expect(manager.getConfig().users.user_a.roles).not.toContain('member');
  });

  it('removeRole is safe for non-existent user', () => {
    expect(() => manager.removeRole('ghost', 'guest')).not.toThrow();
  });

  // ── setRateLimit ──────────────────────────────────────────────

  it('sets rate limit for a user', () => {
    manager.setRateLimit('user_a', 100);
    const config = manager.getConfig();
    expect(config.users.user_a.rateLimit).toBe(100);

    const user = resolveUser(config, 'user_a');
    expect(user.rateLimit).toBe(100);
  });

  it('sets rate limit to null (unlimited)', () => {
    manager.setRateLimit('user_a', null);
    expect(manager.getConfig().users.user_a.rateLimit).toBeNull();
  });

  // ── createRole ────────────────────────────────────────────────

  it('creates a new role', () => {
    manager.createRole('reviewer', {
      name: 'Reviewer',
      permissions: ['message.send', 'agent.file.read'],
      maxMode: 'plan',
    });
    const config = manager.getConfig();
    expect(config.roles.reviewer).toBeDefined();
    expect(config.roles.reviewer.name).toBe('Reviewer');
  });

  // ── deleteRole ────────────────────────────────────────────────

  it('deletes a role', () => {
    manager.deleteRole('admin');
    expect(manager.getConfig().roles.admin).toBeUndefined();
  });

  // ── setDefaultRole ────────────────────────────────────────────

  it('sets the default unknown user role', () => {
    manager.setDefaultRole('member');
    expect(manager.getConfig().defaults.unknownUserRole).toBe('member');
  });

  it('setDefaultRole throws for non-existent role', () => {
    expect(() => manager.setDefaultRole('nope')).toThrow('does not exist');
  });

  // ── Persistence ───────────────────────────────────────────────

  it('persists changes via ConfigLoader.save()', () => {
    manager.grant('user_a', ['agent.file.read']);
    // Reload from loader to verify save was called
    const reloaded = loader.load();
    expect(reloaded.users.user_a.permissions).toContain('agent.file.read');
  });

  // ── reload ────────────────────────────────────────────────────

  it('reload refreshes config from source', () => {
    loader.update({
      users: {
        ...baseConfig.users,
        new_user: { name: 'New', roles: ['member'] },
      },
    });
    manager.reload();
    expect(manager.getConfig().users.new_user).toBeDefined();
  });
});
