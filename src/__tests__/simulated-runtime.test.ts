import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  EnforcementPipeline,
  FileConfigLoader,
  FileSystemMemoryStore,
  PermissionManager,
  RateLimiter,
} from '../index.js';
import type { PermissionConfig, RbacAdapter } from '../types.js';

describe('simulated runtime flow', () => {
  it('supports config hot reload, async memory loading, and protected path enforcement', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-rbac-runtime-'));
    const configPath = path.join(tmpDir, 'permissions.json');
    const memoryRoot = path.join(tmpDir, 'memory');
    const store = new FileSystemMemoryStore(memoryRoot);

    const config: PermissionConfig = {
      owner: 'owner_001',
      roles: {
        guest: {
          name: 'Guest',
          permissions: ['message.send', 'bridge.mode.ask', 'info.own.memory.read'],
          rateLimit: 5,
          maxMode: 'ask',
        },
        member: {
          name: 'Member',
          permissions: [
            'message.send',
            'bridge.mode.ask',
            'bridge.mode.plan',
            'bridge.session.list',
            'agent.file.read',
            'info.own.memory.read',
            'info.own.memory.write',
          ],
          rateLimit: 30,
          maxMode: 'plan',
        },
      },
      users: {
        alice: { name: 'Alice', roles: ['member'] },
      },
      defaults: { unknownUserRole: 'guest' },
      protectedPaths: {
        'info.agent.config.read': [configPath],
      },
    };

    const loader = new FileConfigLoader(configPath);
    loader.save(config);
    await store.write('__public__', 'guidelines', 'public guidance');
    await store.write('alice', 'memory', 'alice long-term memory');

    const adapter: RbacAdapter = {
      mapToolPermission(toolName) {
        return toolName === 'Read' ? 'agent.file.read' : null;
      },
      extractFilePaths(toolCall) {
        if (toolCall.args && typeof toolCall.args.file_path === 'string') {
          return [toolCall.args.file_path];
        }
        return toolCall.filePaths ?? [];
      },
    };

    const pipeline = new EnforcementPipeline({
      configLoader: loader,
      adapter,
      rateLimiter: new RateLimiter({ windowMs: 60_000 }),
      contextLoaderOpts: { memoryStore: store },
    });

    const sessionStart = await pipeline.enforceAsync({
      userId: 'alice',
      message: '/sessions',
      command: '/sessions',
      currentMode: 'plan',
    });
    expect(sessionStart.allowed).toBe(true);
    expect(sessionStart.context?.loadedMemory).toEqual({
      public: { guidelines: 'public guidance' },
      user: { memory: 'alice long-term memory' },
    });

    const protectedRead = await pipeline.enforceAsync({
      userId: 'alice',
      message: '',
      toolCall: {
        toolName: 'Read',
        args: { file_path: configPath },
      },
    });
    expect(protectedRead.allowed).toBe(false);
    expect(protectedRead.deniedBy).toBe('tool-interceptor');

    const manager = new PermissionManager(loader);
    manager.grant('alice', ['info.agent.config.read']);

    const retriedRead = await pipeline.enforceAsync({
      userId: 'alice',
      message: '',
      toolCall: {
        toolName: 'Read',
        args: { file_path: configPath },
      },
    });
    expect(retriedRead.allowed).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
