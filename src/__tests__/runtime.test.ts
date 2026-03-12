import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AgentSecurityRuntime,
  AuditService,
  FileConfigLoader,
  FileSystemAdaptiveStore,
  FileSystemAuditStore,
  FileSystemMemoryStore,
  OpenClawAdapter,
  AdaptivePolicyCopilot,
} from '../index.js';

describe('AgentSecurityRuntime', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-rbac-runtime-'));
    configPath = path.join(tmpDir, 'permissions.json');
    fs.writeFileSync(configPath, JSON.stringify({
      owner: 'owner',
      roles: {
        guest: {
          name: 'Guest',
          permissions: ['message.send', 'bridge.mode.ask', 'info.own.memory.read'],
          maxMode: 'ask',
          rateLimit: 10,
        },
      },
      users: {
        alice: {
          name: 'Alice',
          roles: ['guest'],
        },
      },
      defaults: { unknownUserRole: 'guest' },
      protectedPaths: {
        'info.agent.config.read': [configPath],
      },
    }, null, 2));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('evaluates, records audit, and supports review', async () => {
    const stateDir = path.join(tmpDir, 'state');
    const memoryStore = new FileSystemMemoryStore(path.join(stateDir, 'memory'));
    await memoryStore.write('__public__', 'guidelines', 'shared');
    const runtime = new AgentSecurityRuntime({
      configLoader: new FileConfigLoader(configPath),
      hostAdapter: new OpenClawAdapter(),
      auditService: new AuditService(new FileSystemAuditStore(path.join(stateDir, 'audit'))),
      adaptiveCopilot: new AdaptivePolicyCopilot(new FileSystemAdaptiveStore(path.join(stateDir, 'adaptive'))),
      adapterPermissionMapper: {
        mapToolPermission(toolName) {
          return toolName === 'Read' ? 'agent.file.read' : null;
        },
        extractFilePaths(toolCall) {
          return toolCall.filePaths ?? [];
        },
      },
      pipeline: {
        contextLoaderOpts: { memoryStore },
      },
    });

    const evaluated = await runtime.evaluate({
      userId: 'alice',
      sessionId: 's1',
      text: 'hello',
    });
    expect(evaluated.decision.allowed).toBe(true);
    expect(evaluated.decision.traceId).toBeDefined();

    await runtime.reviewDecision({
      decisionId: evaluated.decision.traceId!,
      reviewerId: 'owner',
      status: 'correct',
    });
  });
});
