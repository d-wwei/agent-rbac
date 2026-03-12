export interface MemoryEntrySummary {
  scope: 'public' | 'tenant' | 'user' | 'session' | 'project' | 'owner';
  key: string;
  included: boolean;
  redacted: boolean;
  redactionReason?: string;
  contentHash?: string;
  preview?: string;
}

export interface ToolDecisionSummary {
  toolName: string;
  requested: 'allow' | 'deny' | 'rewrite';
  requiredPermissions?: string[];
  matchedProtectedPaths?: string[];
  normalizedPaths?: string[];
  reason?: string;
}

export interface OutputDecisionSummary {
  action: 'allow' | 'deny' | 'rewrite' | 'redact';
  affectedSegments?: number;
  diffId?: string;
  reason?: string;
}

export interface DecisionRecord {
  id: string;
  parentId?: string;
  kind: 'request' | 'tool_call' | 'memory_load' | 'output_filter';
  createdAt: string;
  actor: {
    agentId: string;
    hostType: string;
    channel?: string;
    tenantId?: string;
    workspaceId?: string;
    userId: string;
    sessionId: string;
    requestId?: string;
    locale?: string;
  };
  raw: {
    message?: string;
    command?: string;
    commandArgs?: string;
    toolName?: string;
    toolArgsSummary?: Record<string, unknown>;
    candidateOutputSummary?: string;
  };
  normalized: {
    currentMode?: string;
    requestedMode?: string;
    resourcePaths?: string[];
    resourceIds?: string[];
  };
  policy: {
    staticRoles: string[];
    effectiveRole: string;
    effectivePermissions: string[];
    denies: string[];
    dynamicOverlays?: string[];
    trustState?: string;
  };
  memory: {
    requestedScopes?: string[];
    loadedScopes?: string[];
    excludedScopes?: string[];
    loadedEntries?: MemoryEntrySummary[];
  };
  execution: {
    enforcedMode?: string;
    promptGuardApplied?: boolean;
    toolDecisions?: ToolDecisionSummary[];
    outputDecision?: OutputDecisionSummary;
  };
  result: {
    allowed: boolean;
    code?: string;
    reason?: string;
    severity?: 'low' | 'medium' | 'high' | 'critical';
  };
  provenance: {
    source: 'static_policy' | 'adaptive_policy' | 'manual_override' | 'mixed';
    policyVersion: string;
    adapterVersion?: string;
    runtimeVersion?: string;
  };
  review?: {
    status?: 'unreviewed' | 'correct' | 'too_strict' | 'too_permissive' | 'policy_bug' | 'adapter_bug';
    reviewerId?: string;
    reviewedAt?: string;
    note?: string;
  };
}

export interface DiffRecord {
  id: string;
  decisionId: string;
  type: 'text' | 'tool_args' | 'memory_scope' | 'permissions' | 'mode';
  beforeSummary: string;
  afterSummary: string;
  chunks?: Array<{
    kind: 'equal' | 'insert' | 'delete' | 'replace';
    before?: string;
    after?: string;
    reason?: string;
  }>;
}

export interface TimelineFilter {
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  agentId?: string;
  kind?: DecisionRecord['kind'];
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export interface HeatmapFilter {
  tenantId?: string;
  agentId?: string;
  startDate?: string;
  endDate?: string;
}

export interface HeatmapResult {
  dimensions: string[];
  values: Array<{
    key: string;
    count: number;
  }>;
}

export interface WeeklyReport {
  generatedAt: string;
  totals: {
    protected: number;
    denied: number;
    highRisk: number;
    reviewed: number;
  };
  topUsers: Array<{ userId: string; count: number }>;
  topPermissions: Array<{ permission: string; count: number }>;
  findings: string[];
}

export interface ReviewInput {
  decisionId: string;
  reviewerId: string;
  status: NonNullable<DecisionRecord['review']>['status'];
  note?: string;
}
