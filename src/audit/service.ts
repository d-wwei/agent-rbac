import { createHash, randomUUID } from 'node:crypto';
import type { EnforcementResult } from '../types.js';
import type { HostRequest } from '../host/types.js';
import type {
  DecisionRecord,
  DiffRecord,
  HeatmapFilter,
  HeatmapResult,
  ReviewInput,
  TimelineFilter,
  WeeklyReport,
} from './types.js';
import type { AuditStore } from './store.js';

export class AuditService {
  constructor(
    private readonly store: AuditStore,
    private readonly opts?: { hostType?: string; policyVersion?: string; runtimeVersion?: string },
  ) {}

  async recordEnforcement(
    request: HostRequest,
    result: EnforcementResult,
    extra?: {
      dynamicOverlays?: string[];
      trustState?: string;
      outputBefore?: string;
      outputAfter?: string;
      source?: DecisionRecord['provenance']['source'];
    },
  ): Promise<DecisionRecord> {
    const decisionId = randomUUID();
    const loadedMemory = asLoadedMemorySummary(result.context?.loadedMemory);
    const record: DecisionRecord = {
      id: decisionId,
      kind: request.toolIntent ? 'tool_call' : 'request',
      createdAt: new Date().toISOString(),
      actor: {
        agentId: request.identity.agentId,
        hostType: this.opts?.hostType ?? 'generic-host',
        channel: request.identity.channel,
        tenantId: request.identity.tenantId,
        workspaceId: request.identity.workspaceId,
        userId: request.identity.userId,
        sessionId: request.identity.sessionId,
        requestId: request.identity.requestId,
        locale: request.identity.locale,
      },
      raw: {
        message: request.message.text,
        command: request.message.command,
        commandArgs: request.message.commandArgs,
        toolName: request.toolIntent?.toolName,
        toolArgsSummary: summarizeArgs(request.toolIntent?.args),
        candidateOutputSummary: extra?.outputBefore?.slice(0, 500),
      },
      normalized: {
        currentMode: request.message.currentMode,
        requestedMode: request.message.command === '/mode' ? request.message.commandArgs : undefined,
        resourcePaths: request.toolIntent?.resources
          ?.map((resource) => resource.path)
          .filter((value): value is string => Boolean(value)),
        resourceIds: request.toolIntent?.resources
          ?.map((resource) => resource.id)
          .filter((value): value is string => Boolean(value)),
      },
      policy: {
        staticRoles: [result.trace?.effectiveRole ?? 'unknown'],
        effectiveRole: result.trace?.effectiveRole ?? 'unknown',
        effectivePermissions: result.trace?.effectivePermissions ?? [],
        denies: [],
        dynamicOverlays: extra?.dynamicOverlays,
        trustState: extra?.trustState,
      },
      memory: {
        requestedScopes: loadedMemory.requestedScopes,
        loadedScopes: loadedMemory.loadedScopes,
        excludedScopes: loadedMemory.excludedScopes,
        loadedEntries: loadedMemory.loadedEntries,
      },
      execution: {
        enforcedMode: result.enforcedMode,
        promptGuardApplied: Boolean(result.context?.injectedPrompt),
        toolDecisions: request.toolIntent ? [{
          toolName: request.toolIntent.toolName,
          requested: result.allowed ? 'allow' : 'deny',
          requiredPermissions: result.trace?.matchedToolPermissions,
          normalizedPaths: result.trace?.normalizedToolPaths,
          reason: result.reason,
        }] : undefined,
        outputDecision: {
          action: result.allowed ? 'allow' : 'deny',
          affectedSegments: extra?.outputBefore && extra?.outputAfter && extra.outputBefore !== extra.outputAfter ? 1 : 0,
          reason: result.reason,
        },
      },
      result: {
        allowed: result.allowed,
        code: result.code,
        reason: result.reason,
        severity: inferSeverity(result),
      },
      provenance: {
        source: extra?.source ?? 'static_policy',
        policyVersion: this.opts?.policyVersion ?? 'v1',
        runtimeVersion: this.opts?.runtimeVersion ?? 'v1',
      },
      review: {
        status: 'unreviewed',
      },
    };

    await this.store.saveDecision(record);

    if (
      typeof extra?.outputBefore === 'string' &&
      typeof extra?.outputAfter === 'string' &&
      extra.outputBefore !== extra.outputAfter
    ) {
      const diff = this.buildTextDiff(decisionId, extra.outputBefore, extra.outputAfter);
      await this.store.saveDiff(diff);
      record.execution.outputDecision = {
        ...(record.execution.outputDecision ?? { action: 'rewrite' }),
        diffId: diff.id,
      };
      await this.store.saveDecision(record);
    }

    return record;
  }

  async review(input: ReviewInput): Promise<DecisionRecord | null> {
    return this.store.updateReview(input);
  }

  async listTimeline(filter: TimelineFilter = {}): Promise<DecisionRecord[]> {
    return this.store.listDecisions(filter);
  }

  async attachOutputDecision(input: {
    decisionId: string;
    candidateOutput: string;
    finalOutput: string;
    reason?: string;
  }): Promise<DecisionRecord | null> {
    const decision = await this.store.getDecision(input.decisionId);
    if (!decision) {
      return null;
    }

    decision.raw.candidateOutputSummary = input.candidateOutput.slice(0, 500);
    if (input.candidateOutput !== input.finalOutput) {
      const diff = this.buildTextDiff(
        input.decisionId,
        input.candidateOutput,
        input.finalOutput,
      );
      await this.store.saveDiff(diff);
      decision.execution.outputDecision = {
        action: decision.result.allowed ? 'rewrite' : 'deny',
        affectedSegments: 1,
        diffId: diff.id,
        reason: input.reason,
      };
    } else {
      decision.execution.outputDecision = {
        action: 'allow',
        affectedSegments: 0,
        reason: input.reason,
      };
    }
    await this.store.saveDecision(decision);
    return decision;
  }

  async buildHeatmap(filter: HeatmapFilter = {}): Promise<HeatmapResult> {
    const decisions = await this.store.listDecisions({
      tenantId: filter.tenantId,
      agentId: filter.agentId,
      startDate: filter.startDate,
      endDate: filter.endDate,
      limit: 10000,
    });
    const counts = new Map<string, number>();
    for (const decision of decisions) {
      for (const permission of decision.policy.effectivePermissions) {
        counts.set(permission, (counts.get(permission) ?? 0) + 1);
      }
    }
    return {
      dimensions: ['permission'],
      values: Array.from(counts.entries())
        .map(([key, count]) => ({ key, count }))
        .sort((left, right) => right.count - left.count),
    };
  }

  async buildWeeklyReport(filter: {
    tenantId?: string;
    agentId?: string;
    startDate: string;
    endDate: string;
  }): Promise<WeeklyReport> {
    const decisions = await this.store.listDecisions({
      tenantId: filter.tenantId,
      agentId: filter.agentId,
      startDate: filter.startDate,
      endDate: filter.endDate,
      limit: 10000,
    });
    const topUsers = topCounts(decisions.map((decision) => decision.actor.userId), 'userId');
    const topPermissions = topCounts(
      decisions.flatMap((decision) => decision.policy.effectivePermissions),
      'permission',
    );
    const highRisk = decisions.filter((decision) => decision.result.severity === 'high' || decision.result.severity === 'critical').length;
    const reviewed = decisions.filter((decision) => decision.review?.status && decision.review.status !== 'unreviewed').length;
    return {
      generatedAt: new Date().toISOString(),
      totals: {
        protected: decisions.length,
        denied: decisions.filter((decision) => !decision.result.allowed).length,
        highRisk,
        reviewed,
      },
      topUsers,
      topPermissions,
      findings: buildFindings(decisions, highRisk),
    };
  }

  private buildTextDiff(decisionId: string, before: string, after: string): DiffRecord {
    const id = randomUUID();
    return {
      id,
      decisionId,
      type: 'text',
      beforeSummary: before.slice(0, 500),
      afterSummary: after.slice(0, 500),
      chunks: before === after ? [{
        kind: 'equal',
        before,
        after,
      }] : [{
        kind: 'replace',
        before: before.slice(0, 2000),
        after: after.slice(0, 2000),
        reason: 'Protected output differs from raw candidate output.',
      }],
    };
  }
}

function inferSeverity(result: EnforcementResult): DecisionRecord['result']['severity'] {
  if (!result.allowed && result.deniedBy === 'tool-interceptor') return 'high';
  if (!result.allowed) return 'medium';
  return result.trace?.matchedToolPermissions?.length ? 'low' : 'low';
}

function summarizeArgs(
  args: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!args) return undefined;
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.slice(0, 200) : value,
    ]),
  );
}

function asLoadedMemorySummary(value: unknown): {
  requestedScopes?: string[];
  loadedScopes?: string[];
  excludedScopes?: string[];
  loadedEntries?: DecisionRecord['memory']['loadedEntries'];
} {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const loaded = value as Record<string, unknown>;
  const loadedScopes = Object.keys(loaded);
  const loadedEntries = loadedScopes.flatMap((scope) => {
    const entries = loaded[scope];
    if (!entries || typeof entries !== 'object') return [];
    return Object.entries(entries as Record<string, unknown>).map(([key, content]) => ({
      scope: normalizeScope(scope),
      key,
      included: true,
      redacted: false,
      contentHash: hashContent(typeof content === 'string' ? content : JSON.stringify(content)),
      preview: typeof content === 'string' ? content.slice(0, 120) : JSON.stringify(content).slice(0, 120),
    }));
  });
  return {
    requestedScopes: loadedScopes,
    loadedScopes,
    excludedScopes: [],
    loadedEntries,
  };
}

function normalizeScope(scope: string): import('./types.js').MemoryEntrySummary['scope'] {
  switch (scope) {
    case 'public':
    case 'tenant':
    case 'user':
    case 'session':
    case 'project':
    case 'owner':
      return scope;
    default:
      return 'user';
  }
}

function hashContent(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function topCounts(
  values: string[],
  field: 'userId' | 'permission',
): Array<{ [K in typeof field]: string } & { count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ [field]: value, count }) as { [K in typeof field]: string } & { count: number })
    .sort((left, right) => right.count - left.count)
    .slice(0, 10);
}

function buildFindings(decisions: DecisionRecord[], highRisk: number): string[] {
  const findings: string[] = [];
  if (highRisk > 0) {
    findings.push(`High-risk decisions detected: ${highRisk}.`);
  }
  const denied = decisions.filter((decision) => !decision.result.allowed).length;
  if (denied > 0) {
    findings.push(`Denied decisions during interval: ${denied}.`);
  }
  const probingUsers = topCounts(
    decisions
      .filter((decision) => !decision.result.allowed)
      .map((decision) => decision.actor.userId),
    'userId',
  );
  if (probingUsers.length > 0) {
    findings.push(`Most blocked users: ${probingUsers.map((item) => `${item.userId} (${item.count})`).join(', ')}.`);
  }
  if (findings.length === 0) {
    findings.push('No major policy anomalies detected in this interval.');
  }
  return findings;
}
