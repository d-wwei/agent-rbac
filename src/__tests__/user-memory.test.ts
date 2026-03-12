import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { FileSystemMemoryStore } from '../memory/memory-store.js';
import { UserMemoryManager } from '../memory/user-memory.js';
import { resolveUser } from '../core/permission-resolver.js';
import type { PermissionConfig, UserPermissions } from '../types.js';

const config: PermissionConfig = {
  owner: 'owner_001',
  roles: {
    guest: {
      name: 'Guest',
      permissions: ['message.send', 'info.own.memory.read'],
      rateLimit: 20,
      maxMode: 'ask',
    },
    member: {
      name: 'Member',
      permissions: [
        'message.send',
        'info.own.memory.read',
        'info.own.memory.write',
        'info.public.memory.read',
      ],
      rateLimit: 60,
      maxMode: 'plan',
    },
  },
  users: {
    user_a: { name: 'Alice', roles: ['member'] },
    user_b: { name: 'Bob', roles: ['guest'] },
  },
  defaults: { unknownUserRole: 'guest' },
};

describe('FileSystemMemoryStore', () => {
  let tmpDir: string;
  let store: FileSystemMemoryStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rbac-mem-test-'));
    store = new FileSystemMemoryStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes and reads a key', async () => {
    await store.write('user_a', 'profile', '# Alice\nDeveloper');
    const content = await store.read('user_a', 'profile');
    expect(content).toBe('# Alice\nDeveloper');
  });

  it('returns null for non-existent key', async () => {
    const content = await store.read('user_a', 'nonexistent');
    expect(content).toBeNull();
  });

  it('lists keys for a user', async () => {
    await store.write('user_a', 'profile', 'p');
    await store.write('user_a', 'preferences', 'prefs');
    await store.write('user_a', 'memory', 'mem');
    const keys = await store.list('user_a');
    expect(keys.sort()).toEqual(['memory', 'preferences', 'profile']);
  });

  it('returns empty list for non-existent user', async () => {
    const keys = await store.list('nonexistent');
    expect(keys).toEqual([]);
  });

  it('deletes a key', async () => {
    await store.write('user_a', 'temp', 'data');
    expect(await store.exists('user_a', 'temp')).toBe(true);
    const deleted = await store.delete('user_a', 'temp');
    expect(deleted).toBe(true);
    expect(await store.exists('user_a', 'temp')).toBe(false);
  });

  it('delete returns false for non-existent key', async () => {
    const deleted = await store.delete('user_a', 'ghost');
    expect(deleted).toBe(false);
  });

  it('sanitizes user and key names to prevent traversal', async () => {
    await store.write('../etc', 'passwd', 'bad');
    // Should be stored under sanitized path, not actual ../etc
    const content = await store.read('../etc', 'passwd');
    expect(content).toBe('bad');
    // Verify the actual file is in the tmpDir, not /etc
    const expectedDir = path.join(tmpDir, '___etc');
    expect(fs.existsSync(expectedDir)).toBe(true);
  });

  it('handles nested keys (sessions/xxx)', async () => {
    await store.write('user_a', 'sessions/session_001', 'session data');
    const content = await store.read('user_a', 'sessions/session_001');
    expect(content).toBe('session data');
    expect(await store.list('user_a')).toContain('sessions/session_001');
  });
});

describe('UserMemoryManager', () => {
  let tmpDir: string;
  let store: FileSystemMemoryStore;
  let manager: UserMemoryManager;
  let owner: UserPermissions;
  let userA: UserPermissions;
  let userB: UserPermissions;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rbac-umm-test-'));
    store = new FileSystemMemoryStore(tmpDir);
    manager = new UserMemoryManager(store);
    owner = resolveUser(config, 'owner_001');
    userA = resolveUser(config, 'user_a');
    userB = resolveUser(config, 'user_b');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Isolation ─────────────────────────────────────────────────

  it('user can access own memory', () => {
    expect(manager.canAccess(userA, 'user_a')).toBe(true);
  });

  it('user cannot access another user\'s memory', () => {
    expect(manager.canAccess(userA, 'user_b')).toBe(false);
  });

  it('owner can access any user\'s memory', () => {
    expect(manager.canAccess(owner, 'user_a')).toBe(true);
    expect(manager.canAccess(owner, 'user_b')).toBe(true);
  });

  // ── Profile CRUD ──────────────────────────────────────────────

  it('user writes and reads own profile', async () => {
    const ok = await manager.writeProfile(userA, 'user_a', '# Alice Profile');
    expect(ok).toBe(true);
    const content = await manager.readProfile(userA, 'user_a');
    expect(content).toBe('# Alice Profile');
  });

  it('user cannot read another user\'s profile', async () => {
    await store.write('user_b', 'profile', '# Bob Profile');
    const content = await manager.readProfile(userA, 'user_b');
    expect(content).toBeNull();
  });

  it('owner reads any user\'s profile', async () => {
    await store.write('user_a', 'profile', '# Alice');
    const content = await manager.readProfile(owner, 'user_a');
    expect(content).toBe('# Alice');
  });

  it('cross-user read permission does not imply cross-user write permission', async () => {
    const auditor = resolveUser(
      {
        ...config,
        roles: {
          ...config.roles,
          auditor: {
            name: 'Auditor',
            permissions: ['message.send', 'info.others.memory.read'],
            maxMode: 'ask',
          },
        },
        users: {
          ...config.users,
          auditor_user: { name: 'Auditor', roles: ['auditor'] },
        },
      },
      'auditor_user',
    );
    await store.write('user_b', 'profile', '# Bob');
    expect(await manager.readProfile(auditor, 'user_b')).toBe('# Bob');
    expect(await manager.writeProfile(auditor, 'user_b', 'overwrite')).toBe(false);
  });

  // ── Preferences ───────────────────────────────────────────────

  it('user writes and reads own preferences', async () => {
    await manager.writePreferences(userA, 'user_a', 'lang: zh');
    const content = await manager.readPreferences(userA, 'user_a');
    expect(content).toBe('lang: zh');
  });

  it('read permission does not imply write permission', async () => {
    const readOnlyUser = resolveUser(
      {
        ...config,
        users: {
          ...config.users,
          user_ro: { name: 'ReadOnly', roles: ['guest'] },
        },
      },
      'user_ro',
    );
    expect(await manager.writeMemory(readOnlyUser, 'user_ro', 'blocked')).toBe(false);
  });

  // ── Memory ────────────────────────────────────────────────────

  it('user writes and reads long-term memory', async () => {
    await manager.writeMemory(userA, 'user_a', '# Facts\n- likes coffee');
    const content = await manager.readMemory(userA, 'user_a');
    expect(content).toBe('# Facts\n- likes coffee');
  });

  // ── Sessions ──────────────────────────────────────────────────

  it('user reads and writes session data', async () => {
    await manager.writeSession(userA, 'user_a', 'sess_001', 'Session notes');
    const content = await manager.readSession(userA, 'user_a', 'sess_001');
    expect(content).toBe('Session notes');
  });

  it('user cannot access another user\'s sessions', async () => {
    await store.write('user_b', 'sessions/sess_001', 'Bob session');
    const content = await manager.readSession(userA, 'user_b', 'sess_001');
    expect(content).toBeNull();
  });

  // ── Projects ──────────────────────────────────────────────────

  it('user reads and writes project data', async () => {
    await manager.writeProject(userA, 'user_a', 'my-project', 'Project notes');
    const content = await manager.readProject(userA, 'user_a', 'my-project');
    expect(content).toBe('Project notes');
  });

  // ── Generic CRUD ──────────────────────────────────────────────

  it('generic read/write/delete/list works', async () => {
    await manager.write(userA, 'user_a', 'custom-key', 'data');
    expect(await manager.read(userA, 'user_a', 'custom-key')).toBe('data');

    const keys = await manager.listKeys(userA, 'user_a');
    expect(keys).toContain('custom-key');

    await manager.deleteKey(userA, 'user_a', 'custom-key');
    expect(await manager.read(userA, 'user_a', 'custom-key')).toBeNull();
  });

  it('cross-user generic access is denied', async () => {
    await store.write('user_b', 'secret', 'hidden');
    expect(await manager.read(userA, 'user_b', 'secret')).toBeNull();
    expect(await manager.write(userA, 'user_b', 'hack', 'pwned')).toBe(false);
    expect(await manager.deleteKey(userA, 'user_b', 'secret')).toBe(false);
    expect(await manager.listKeys(userA, 'user_b')).toEqual([]);
  });
});
