import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { FileConfigLoader, InMemoryConfigLoader } from '../config/loader.js';
import { DEFAULT_CONFIG } from '../config/defaults.js';
import type { PermissionConfig } from '../types.js';

const testConfig: PermissionConfig = {
  owner: 'test_owner',
  roles: {
    guest: {
      name: 'Guest',
      permissions: ['message.send'],
      rateLimit: 10,
      maxMode: 'ask',
    },
  },
  users: {},
  defaults: { unknownUserRole: 'guest' },
};

describe('InMemoryConfigLoader', () => {
  it('loads config from memory', () => {
    const loader = new InMemoryConfigLoader(testConfig);
    const loaded = loader.load();
    expect(loaded.owner).toBe('test_owner');
    expect(loaded.roles.guest.name).toBe('Guest');
  });

  it('saves config to memory', () => {
    const loader = new InMemoryConfigLoader(testConfig);
    const updated = { ...testConfig, owner: 'new_owner' };
    loader.save(updated);
    expect(loader.load().owner).toBe('new_owner');
  });

  it('updates config partially', () => {
    const loader = new InMemoryConfigLoader(testConfig);
    loader.update({ owner: 'partial_update' });
    expect(loader.load().owner).toBe('partial_update');
    expect(loader.load().roles.guest.name).toBe('Guest');
  });
});

describe('FileConfigLoader', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-rbac-test-'));
    configPath = path.join(tmpDir, 'permissions.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads valid config from file', () => {
    fs.writeFileSync(configPath, JSON.stringify(testConfig));
    const loader = new FileConfigLoader(configPath);
    const loaded = loader.load();
    expect(loaded.owner).toBe('test_owner');
  });

  it('saves config to file', () => {
    const loader = new FileConfigLoader(configPath);
    loader.save(testConfig);
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.owner).toBe('test_owner');
  });

  it('recovers owner from malformed JSON via regex', () => {
    fs.writeFileSync(configPath, '{ "owner": "recovered_owner", broken }');
    const loader = new FileConfigLoader(configPath);
    const loaded = loader.load();
    expect(loaded.owner).toBe('recovered_owner');
    expect(loaded.roles.guest).toBeDefined();
  });

  it('returns guest default when file is missing', () => {
    const loader = new FileConfigLoader(
      path.join(tmpDir, 'nonexistent.json'),
    );
    const loaded = loader.load();
    expect(loaded.owner).toBe('');
    expect(loaded.defaults.unknownUserRole).toBe('guest');
  });

  it('creates parent directory on save if missing', () => {
    const deepPath = path.join(tmpDir, 'sub', 'dir', 'config.json');
    const loader = new FileConfigLoader(deepPath);
    loader.save(testConfig);
    expect(fs.existsSync(deepPath)).toBe(true);
  });
});
