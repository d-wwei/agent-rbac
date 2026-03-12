import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileSystemAuditStore } from '../audit/store.js';
import { AuditService } from '../audit/service.js';
import type { HostRequest } from '../host/types.js';
import type { EnforcementResult } from '../types.js';

describe('AuditService', () => {
  let tmpDir: string;
  let store: FileSystemAuditStore;
  let service: AuditService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-rbac-audit-'));
    store = new FileSystemAuditStore(tmpDir);
    service = new AuditService(store, { hostType: 'openclaw' });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records decision, diff, and review state', async () => {
    const request: HostRequest = {
      identity: {
        userId: 'alice',
        sessionId: 's1',
        agentId: 'openclaw',
      },
      message: {
        text: 'hello',
      },
    };
    const result: EnforcementResult = {
      allowed: true,
      enforcedMode: 'ask',
      context: {
        loadedMemory: {
          public: { guidelines: 'shared' },
        },
      },
      trace: {
        evaluatedLayers: ['gateway'],
        effectiveRole: 'guest',
        effectivePermissions: ['message.send'],
      },
    };
    const record = await service.recordEnforcement(request, result, {
      outputBefore: 'secret response',
      outputAfter: 'filtered response',
    });
    const stored = await store.getDecision(record.id);
    expect(stored?.execution.outputDecision?.diffId).toBeDefined();

    const reviewed = await service.review({
      decisionId: record.id,
      reviewerId: 'owner',
      status: 'correct',
      note: 'looks good',
    });
    expect(reviewed?.review?.status).toBe('correct');
  });

  it('builds a weekly report', async () => {
    const now = new Date().toISOString();
    await store.saveDecision({
      id: 'd1',
      kind: 'request',
      createdAt: now,
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
        effectivePermissions: ['message.send'],
        denies: [],
      },
      memory: {},
      execution: {},
      result: {
        allowed: false,
        code: 'tool.path',
        reason: 'blocked',
        severity: 'high',
      },
      provenance: {
        source: 'static_policy',
        policyVersion: 'v1',
      },
      review: {
        status: 'unreviewed',
      },
    });
    const report = await service.buildWeeklyReport({
      startDate: now.slice(0, 10),
      endDate: `${now.slice(0, 10)}T23:59:59.999Z`,
    });
    expect(report.totals.protected).toBe(1);
    expect(report.totals.highRisk).toBe(1);
  });
});
