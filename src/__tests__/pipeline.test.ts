import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EnforcementPipeline } from '../enforcement/pipeline.js';
import { InMemoryConfigLoader } from '../config/loader.js';
import { RateLimiter } from '../core/rate-limiter.js';
import { FileSystemMemoryStore } from '../memory/memory-store.js';
import type { PermissionConfig, RbacAdapter } from '../types.js';

const testConfig: PermissionConfig = {
  owner: 'owner_001',
  roles: {
    guest: {
      name: 'Guest',
      permissions: ['message.send'],
      deny: [],
      rateLimit: 3,
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
        'agent.file.read',
        'info.own.memory.read',
        'info.own.memory.write',
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
    user_member: { name: 'Alice', roles: ['member'] },
    user_admin: { name: 'Bob', roles: ['admin'] },
    user_no_send: { name: 'Silent', roles: ['guest'], deny: ['message.send'] },
  },
  defaults: { unknownUserRole: 'guest' },
  protectedPaths: {
    'info.agent.config.read': ['~/.agent/permissions.json'],
  },
};

describe('EnforcementPipeline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createPipeline(config?: PermissionConfig, adapter?: RbacAdapter) {
    return new EnforcementPipeline({
      configLoader: new InMemoryConfigLoader(config ?? testConfig),
      adapter,
      rateLimiter: new RateLimiter({ windowMs: 3600_000 }),
    });
  }

  // ── Layer 1: Gateway ──────────────────────────────────────────

  it('Layer 1: allows messages within rate limit', () => {
    const pipeline = createPipeline();
    const result = pipeline.enforce({
      userId: 'unknown_guest',
      message: 'hello',
    });
    expect(result.allowed).toBe(true);
  });

  it('Layer 1: blocks messages exceeding rate limit', () => {
    const pipeline = createPipeline();
    // Guest has rateLimit: 3
    pipeline.enforce({ userId: 'guest_x', message: '1' });
    pipeline.enforce({ userId: 'guest_x', message: '2' });
    pipeline.enforce({ userId: 'guest_x', message: '3' });
    const result = pipeline.enforce({ userId: 'guest_x', message: '4' });
    expect(result.allowed).toBe(false);
    expect(result.deniedBy).toBe('gateway');
  });

  it('Layer 1: blocks user without message.send permission', () => {
    const pipeline = createPipeline();
    const result = pipeline.enforce({
      userId: 'user_no_send',
      message: 'hello',
    });
    expect(result.allowed).toBe(false);
    expect(result.deniedBy).toBe('gateway');
  });

  it('Layer 1: owner has no rate limit', () => {
    const pipeline = createPipeline();
    for (let i = 0; i < 100; i++) {
      const result = pipeline.enforce({
        userId: 'owner_001',
        message: `msg ${i}`,
      });
      expect(result.allowed).toBe(true);
    }
  });

  // ── Layer 2: Command Filter ───────────────────────────────────

  it('Layer 2: allows command with permission', () => {
    const pipeline = createPipeline();
    const result = pipeline.enforce({
      userId: 'user_member',
      message: '/sessions',
      command: '/sessions',
    });
    expect(result.allowed).toBe(true);
  });

  it('Layer 2: blocks command without permission', () => {
    const pipeline = createPipeline();
    const result = pipeline.enforce({
      userId: 'user_member',
      message: '/new',
      command: '/new',
    });
    expect(result.allowed).toBe(false);
    expect(result.deniedBy).toBe('command-filter');
  });

  it('Layer 2: allows always-allowed commands for anyone', () => {
    const pipeline = createPipeline();
    const result = pipeline.enforce({
      userId: 'unknown_guest',
      message: '/help',
      command: '/help',
    });
    expect(result.allowed).toBe(true);
  });

  it('Layer 2: blocks unknown commands in strict mode', () => {
    const pipeline = createPipeline();
    const result = pipeline.enforce({
      userId: 'unknown_guest',
      message: '/mystery',
      command: '/mystery',
    });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('command_filter.unknown');
  });

  it('Layer 2: handles /mode with args', () => {
    const pipeline = createPipeline();
    // Member has bridge.mode.plan
    const planResult = pipeline.enforce({
      userId: 'user_member',
      message: '/mode plan',
      command: '/mode',
      commandArgs: 'plan',
    });
    expect(planResult.allowed).toBe(true);

    // Member does NOT have bridge.mode.code
    const codeResult = pipeline.enforce({
      userId: 'user_member',
      message: '/mode code',
      command: '/mode',
      commandArgs: 'code',
    });
    expect(codeResult.allowed).toBe(false);
  });

  // ── Layer 4: Capability Mode ──────────────────────────────────

  it('Layer 4: enforces max mode for user', () => {
    const pipeline = createPipeline();
    const result = pipeline.enforce({
      userId: 'user_member',
      message: 'hello',
    });
    expect(result.allowed).toBe(true);
    expect(result.enforcedMode).toBe('plan');
  });

  it('Layer 4: signals mode downgrade when session exceeds allowed', () => {
    const pipeline = createPipeline();
    const result = pipeline.enforce({
      userId: 'user_member',
      message: 'hello',
      currentMode: 'code',
    });
    expect(result.allowed).toBe(true);
    expect(result.enforcedMode).toBe('plan');
    expect(result.context?.modeDowngraded).toBe(true);
  });

  // ── Layer 5: Tool Interception ────────────────────────────────

  it('Layer 5: blocks access to protected paths', () => {
    const pipeline = createPipeline();
    const result = pipeline.enforce({
      userId: 'user_member',
      message: '',
      toolCall: {
        toolName: 'Read',
        filePaths: ['~/.agent/permissions.json'],
      },
    });
    expect(result.allowed).toBe(false);
    expect(result.deniedBy).toBe('tool-interceptor');
  });

  it('Layer 5: allows owner to access protected paths', () => {
    const pipeline = createPipeline();
    const result = pipeline.enforce({
      userId: 'owner_001',
      message: '',
      toolCall: {
        toolName: 'Read',
        filePaths: ['~/.agent/permissions.json'],
      },
    });
    expect(result.allowed).toBe(true);
  });

  it('Layer 5: uses adapter for tool-level permission mapping', () => {
    const adapter: RbacAdapter = {
      mapToolPermission(toolName) {
        if (toolName === 'Bash') return 'agent.bash.write';
        return null;
      },
    };
    const pipeline = createPipeline(undefined, adapter);
    const result = pipeline.enforce({
      userId: 'user_member',
      message: '',
      toolCall: { toolName: 'Bash' },
    });
    expect(result.allowed).toBe(false);
    expect(result.deniedBy).toBe('tool-interceptor');
  });

  // ── Layer 6: Prompt Builder ───────────────────────────────────

  it('Layer 6: injects role prompt for non-owner', () => {
    const pipeline = createPipeline();
    const result = pipeline.enforce({
      userId: 'unknown_guest',
      message: 'hello',
    });
    expect(result.allowed).toBe(true);
    expect(result.context?.injectedPrompt).toBeDefined();
    expect(typeof result.context?.injectedPrompt).toBe('string');
    expect(result.context?.userRole).toBe('guest');
  });

  it('Layer 6: no prompt injection for owner', () => {
    const pipeline = createPipeline();
    const result = pipeline.enforce({
      userId: 'owner_001',
      message: 'hello',
    });
    expect(result.allowed).toBe(true);
    // Owner prompt is empty string, so no injectedPrompt context
    expect(result.context?.injectedPrompt).toBeUndefined();
  });

  // ── End-to-end ────────────────────────────────────────────────

  it('full pipeline: guest sends messages, gets limited mode and prompt', () => {
    const pipeline = createPipeline();
    const result = pipeline.enforce({
      userId: 'random_guest',
      message: 'What can you do?',
    });
    expect(result.allowed).toBe(true);
    expect(result.enforcedMode).toBe('ask');
    expect(result.context?.injectedPrompt).toBeDefined();
    expect(result.context?.userRole).toBe('guest');
    expect(result.trace?.evaluatedLayers).toContain('gateway');
  });

  it('full pipeline: admin has full access', () => {
    const pipeline = createPipeline();
    const result = pipeline.enforce({
      userId: 'user_admin',
      message: '/new',
      command: '/new',
      currentMode: 'code',
    });
    expect(result.allowed).toBe(true);
    expect(result.enforcedMode).toBe('code');
  });

  // ── Hot-reload ────────────────────────────────────────────────

  it('config changes take effect on next enforce call', () => {
    const loader = new InMemoryConfigLoader(testConfig);
    const pipeline = new EnforcementPipeline({
      configLoader: loader,
      rateLimiter: new RateLimiter(),
    });

    // Guest can send
    const r1 = pipeline.enforce({ userId: 'some_user', message: 'hi' });
    expect(r1.allowed).toBe(true);

    // Change default role to have no message.send
    loader.update({
      roles: {
        ...testConfig.roles,
        guest: {
          name: 'Guest',
          permissions: [],
          rateLimit: 20,
          maxMode: 'ask',
        },
      },
    });

    // Next call sees updated config
    const r2 = pipeline.enforce({ userId: 'some_user', message: 'hi' });
    expect(r2.allowed).toBe(false);
    expect(r2.deniedBy).toBe('gateway');
  });

  // ── resolveUser helper ────────────────────────────────────────

  it('resolveUser exposes quick permission resolution', () => {
    const pipeline = createPipeline();
    const user = pipeline.resolveUser('user_member');
    expect(user.name).toBe('Alice');
    expect(user.topRole).toBe('member');
  });

  it('enforceAsync loads scoped memory for non-owner sessions', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-rbac-pipeline-'));
    const store = new FileSystemMemoryStore(tmpDir);
    await store.write('__public__', 'guidelines', 'shared rules');
    await store.write('user_member', 'memory', 'alice memory');

    const pipeline = new EnforcementPipeline({
      configLoader: new InMemoryConfigLoader(testConfig),
      rateLimiter: new RateLimiter({ windowMs: 3600_000 }),
      contextLoaderOpts: { memoryStore: store },
    });

    const result = await pipeline.enforceAsync({
      userId: 'user_member',
      message: 'hello',
    });

    expect(result.allowed).toBe(true);
    expect(result.context?.loadedMemory).toEqual({
      public: { guidelines: 'shared rules' },
      user: { memory: 'alice memory' },
    });

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
