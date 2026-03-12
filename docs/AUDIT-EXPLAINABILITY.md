# Audit & Explainability Design

Status: Draft v1
Owner: agent-rbac
Scope: Cross-agent, host-agnostic

## 1. Purpose

`agent-rbac` cannot remain a hidden enforcement layer. Every protection decision must be explainable to humans, reviewable after the fact, and attributable when something goes wrong.

This document defines the "black box" system for:

- recording the full decision chain behind each request
- showing what changed between raw and protected execution
- supporting human review, correction, and takeover
- generating trust-building summaries instead of noisy logs

This is not a generic logging subsystem. It is a product-level decision replay system.

## 2. Product Principles

### 2.1 Default Quiet, Always Transparent

- Do not interrupt users for routine events.
- Escalate only high-signal alerts in real time.
- Preserve a complete replay trail so humans can inspect any event later.

### 2.2 Record Process, Not Just Result

The system must preserve:

- what came in
- how it was normalized
- what policy was applied
- what content or capabilities were removed
- what the final allowed surface became

Storing only `allowed=false` or `filtered=true` is insufficient.

### 2.3 Replay Must Support Responsibility

An auditor must be able to answer:

- why did this happen
- which rule or override caused it
- who approved it
- whether it came from static policy, adaptive policy, or manual intervention

### 2.4 The Audit Layer Is Also Sensitive Data

Audit storage must itself be protected by RBAC and redaction rules. The black box cannot become a second leakage surface.

## 3. Core User Jobs

### 3.1 Agent Owner

Needs to know:

- whether the system is actually protecting anything
- where users are being blocked or probing
- whether the current policy is too strict or too loose

### 3.2 Auditor / Security Reviewer

Needs to know:

- what exactly happened in a specific incident
- what data was visible vs hidden
- which control path made the decision

### 3.3 Operator / Team Admin

Needs to know:

- where review volume is concentrated
- whether a certain user or tenant is repeatedly hitting boundaries
- whether a policy change reduced or increased risk

## 4. Functional Capabilities

### 4.1 Decision Record

Each request creates one immutable `DecisionRecord`.

Each tool call inside a request may also create `SubDecisionRecord`s linked to the parent request.

### 4.2 Diff View

The system must support comparison of:

- raw candidate output vs protected output
- raw requested tool call vs sanitized tool call
- requested memory scope vs loaded memory scope
- requested mode vs enforced mode

### 4.3 Decision Chain Replay

The system must show, in order:

1. request received
2. identity resolved
3. session / tenant context resolved
4. role and effective permissions resolved
5. memory candidates discovered
6. memory loaded / excluded
7. prompt guard injected
8. tool calls attempted
9. tool calls allowed / blocked / rewritten
10. final output allowed / rewritten / denied

### 4.4 Human Review Actions

Each decision must allow humans to mark:

- `correct`
- `too_strict`
- `too_permissive`
- `needs_follow_up`
- `policy_bug`
- `adapter_bug`

Each review action may carry notes and a suggested policy action.

### 4.5 Timeline, Heatmap, Reports

The system must support:

- per-request replay
- day / week / month timelines
- risk heatmaps by permission, resource, tenant, agent, and user
- weekly summaries
- anomaly alerts

## 5. Decision Record Model

```ts
type DecisionRecord = {
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
};
```

### 5.1 Supporting Summaries

```ts
type MemoryEntrySummary = {
  scope: 'public' | 'tenant' | 'user' | 'session' | 'project' | 'owner';
  key: string;
  included: boolean;
  redacted: boolean;
  redactionReason?: string;
  contentHash?: string;
  preview?: string;
};

type ToolDecisionSummary = {
  toolName: string;
  requested: 'allow' | 'deny' | 'rewrite';
  requiredPermissions?: string[];
  matchedProtectedPaths?: string[];
  normalizedPaths?: string[];
  reason?: string;
};

type OutputDecisionSummary = {
  action: 'allow' | 'deny' | 'rewrite' | 'redact';
  affectedSegments?: number;
  diffId?: string;
  reason?: string;
};
```

## 6. Diff Model

The diff system must support multiple artifacts, not only text.

### 6.1 Diff Types

- text diff
- tool args diff
- memory scope diff
- permissions diff
- mode diff

### 6.2 Diff Record

```ts
type DiffRecord = {
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
};
```

## 7. UI Surfaces

### 7.1 Black Box Dashboard

Primary widgets:

- protection events today
- high-risk blocks
- suspected probing users
- top protected resources
- confidence / trust trend

### 7.2 Event Detail View

Sections:

- request summary
- identity and context
- decision chain timeline
- memory inclusion / exclusion table
- diff panel
- tool decision panel
- provenance and responsibility
- human review actions

### 7.3 Risk Heatmap

Dimensions:

- permission x user
- permission x tenant
- resource x time
- agent x risk level

### 7.4 Weekly Report

Must answer:

- how many events were protected
- how many were high risk
- what was newly probed
- where humans overruled the system
- which policy adjustments are suggested

## 8. Alerts

Real-time alerts should be rare and high-signal.

Trigger examples:

- repeated cross-user memory probing
- repeated sensitive path probing
- sudden privilege pattern shift
- a new agent adapter producing many `adapter_bug` reviews
- a spike in `too_permissive` feedback

## 9. Human Review Workflow

### 9.1 Review States

- `unreviewed`
- `confirmed_correct`
- `too_strict`
- `too_permissive`
- `policy_bug`
- `adapter_bug`
- `escalated`

### 9.2 Review Outcomes

A review may produce:

- no change
- create feedback sample for learning
- create policy suggestion
- create incident ticket
- add regression test fixture

## 10. Storage and Security

### 10.1 Storage Tiers

- hot storage: recent searchable records
- warm storage: summarized historical records
- cold storage: exportable archives

### 10.2 Sensitivity Rules

- raw prompts should default to summarized storage
- sensitive memory content should default to hashed + preview storage
- original output and diff details require elevated review permission

### 10.3 Retention

Retention should be configurable by:

- tenant
- sensitivity
- environment
- legal / compliance policy

## 11. API Surface

Recommended service interfaces:

```ts
interface AuditRecorder {
  record(decision: DecisionRecord): Promise<void>;
  recordDiff(diff: DiffRecord): Promise<void>;
}

interface AuditQueryService {
  getDecision(id: string): Promise<DecisionRecord | null>;
  listTimeline(filter: TimelineFilter): Promise<DecisionRecord[]>;
  getHeatmap(filter: HeatmapFilter): Promise<HeatmapResult>;
  getWeeklyReport(filter: WeeklyReportFilter): Promise<WeeklyReport>;
}

interface AuditReviewService {
  markReview(input: ReviewInput): Promise<void>;
}
```

## 12. Phased Delivery

### Phase 1

- decision records
- timeline list
- event detail page
- basic diff for mode, memory scope, output summary
- manual review tags

### Phase 2

- heatmaps
- weekly report
- richer text diffs
- alerting

### Phase 3

- root-cause guidance
- review-to-policy linkage
- tenant benchmarking
- regression fixture generation

## 13. Success Metrics

- time to explain a single decision
- percentage of high-risk incidents with complete replay data
- review turnaround time
- percentage of policy changes backed by audit evidence
- reduction in "black box distrust" feedback

