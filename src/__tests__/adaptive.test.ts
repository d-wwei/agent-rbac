import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileSystemAdaptiveStore } from '../adaptive/store.js';
import { AdaptivePolicyCopilot } from '../adaptive/service.js';
import type { DecisionRecord } from '../audit/types.js';
import type { PermissionConfig } from '../types.js';

describe('AdaptivePolicyCopilot', () => {
  let tmpDir: string;
  let copilot: AdaptivePolicyCopilot;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-rbac-adaptive-'));
    copilot = new AdaptivePolicyCopilot(new FileSystemAdaptiveStore(tmpDir));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('builds familiarity and suggestions from repeated feedback', async () => {
    for (let index = 0; index < 3; index += 1) {
      await copilot.ingestDecision(makeDecision(`d-${index}`, 'too_strict'));
    }
    const familiarity = await copilot.getFamiliarity('alice');
    const suggestions = await copilot.getSuggestions('alice');
    expect(familiarity?.score).toBeGreaterThan(0);
    expect(suggestions.some((item) => item.kind === 'grant_permission')).toBe(true);
  });

  it('applies overlays into config for a user', async () => {
    const suggestions = await copilot.getSuggestions();
    expect(suggestions).toEqual([]);
    const store = new FileSystemAdaptiveStore(tmpDir);
    await store.saveOverlay({
      id: 'ov1',
      scope: 'user',
      targetId: 'alice',
      changes: {
        addPermissions: ['agent.web.search'],
      },
      source: 'approved',
      riskTier: 'low',
      createdAt: new Date().toISOString(),
    });
    const config: PermissionConfig = {
      owner: 'owner',
      roles: {
        guest: {
          name: 'Guest',
          permissions: ['message.send'],
          maxMode: 'ask',
        },
      },
      users: {
        alice: { name: 'Alice', roles: ['guest'] },
      },
      defaults: { unknownUserRole: 'guest' },
    };
    const overlays = await copilot.listActiveOverlays('alice');
    const merged = copilot.applyOverlays(config, 'alice', undefined, overlays);
    expect(merged.users.alice.permissions).toContain('agent.web.search');
  });
});

function makeDecision(id: string, reviewStatus: NonNullable<DecisionRecord['review']>['status']): DecisionRecord {
  return {
    id,
    kind: 'request',
    createdAt: new Date().toISOString(),
    actor: {
      agentId: 'openclaw',
      hostType: 'openclaw',
      userId: 'alice',
      sessionId: 's1',
    },
    raw: {},
    normalized: {},
    policy: {
      staticRoles: ['guest'],
      effectiveRole: 'guest',
      effectivePermissions: ['info.own.memory.read'],
      denies: [],
    },
    memory: {},
    execution: {},
    result: {
      allowed: false,
      code: 'command_filter.forbidden',
      reason: 'blocked',
      severity: 'medium',
    },
    provenance: {
      source: 'static_policy',
      policyVersion: 'v1',
    },
    review: {
      status: reviewStatus,
    },
  };
}
