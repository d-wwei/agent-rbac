# Data, Storage & Privacy Design

Status: Draft v1
Owner: agent-rbac
Scope: Cross-agent, host-agnostic

## 1. Purpose

This document defines what data `agent-rbac` stores, how it should be partitioned, and how privacy boundaries are preserved across runtime, audit, and adaptive learning.

## 2. Storage Domains

The product stores four distinct classes of data:

1. policy data
2. runtime memory data
3. audit / replay data
4. adaptive learning data

Each domain has different access rules and retention needs.

## 3. Policy Data

Includes:

- roles
- direct grants / denies
- protected resources
- overlays
- approval records

Requirements:

- versioned
- diffable
- rollback-friendly
- tenant-aware

## 4. Runtime Memory Data

Includes:

- public memory
- tenant memory
- user memory
- session memory
- project memory
- owner memory

Requirements:

- strict isolation by scope
- separate from audit detail storage
- no implicit cross-user loading

## 5. Audit Data

Includes:

- decision records
- diff records
- review actions
- alerts
- reports

Requirements:

- immutable append-oriented writes
- query-friendly summaries
- redaction support
- fine-grained access control

## 6. Adaptive Learning Data

Includes:

- behavioral observations
- inferred labels
- trust bands
- familiarity metrics
- suggestion history
- acceptance/rejection history

Requirements:

- traceable to source evidence
- distinct from durable role config
- expirable when stale

## 7. Partitioning Strategy

Recommended partition keys:

- tenant
- user
- agent
- time
- sensitivity

This enables:

- tenant isolation
- cheaper reporting
- retention policy control

## 8. Sensitivity Classes

Data should be classified into:

- public
- internal
- sensitive
- restricted

Examples:

- policy metadata: internal
- audit summaries: internal
- raw prompt fragments involving private user data: sensitive
- cross-tenant incident records: restricted

## 9. Storage Views

### 9.1 Hot Operational Storage

Used for:

- recent event inspection
- current overlays
- active suggestions

### 9.2 Warm Analytical Storage

Used for:

- timelines
- heatmaps
- weekly reports
- familiarity trends

### 9.3 Cold Archive Storage

Used for:

- compliance exports
- incident archives
- long-range trend analysis

## 10. Privacy Controls

### 10.1 Data Minimization

Default to storing summaries, hashes, previews, or references instead of full raw content whenever possible.

### 10.2 Redaction by Default

Sensitive artifacts should support:

- preview truncation
- token masking
- field-level redaction
- resource path masking

### 10.3 Access Segmentation

The following should be separately permissioned:

- audit summary access
- sensitive audit detail access
- adaptive suggestion access
- policy edit access

## 11. Retention Strategy

Retention should be configurable per domain.

Suggested defaults:

- runtime session memory: product-defined
- hot audit records: 30-90 days
- warm summary data: 6-12 months
- cold archives: compliance-dependent
- adaptive overlays: expire unless renewed

## 12. Data Models

### 12.1 Policy Snapshot

```ts
type PolicySnapshot = {
  id: string;
  version: string;
  tenantId?: string;
  createdAt: string;
  source: 'static' | 'approved_suggestion' | 'manual_override';
  roles: Record<string, unknown>;
  overlays: Record<string, unknown>;
};
```

### 12.2 Familiarity Snapshot

```ts
type FamiliaritySnapshot = {
  scopeType: 'user' | 'group' | 'tenant';
  scopeId: string;
  score: number;
  state: 'learning' | 'stabilizing' | 'aligned' | 'watchful';
  updatedAt: string;
  signals: Record<string, number>;
};
```

## 13. Privacy Guardrails for Learning

Adaptive learning must not require indefinite storage of raw sensitive content.

Preferred pattern:

- learn from reviewed summaries and structured signals
- keep raw content references only when strictly needed
- support per-tenant opt-out or stricter privacy mode

## 14. Incident Handling

For high-risk incidents, the system should support:

- frozen record preservation
- restricted access view
- explicit chain of custody
- exportable incident package

## 15. Success Criteria

This design succeeds when:

- audit data is useful without becoming a leakage source
- adaptive learning can improve policy without over-collecting sensitive content
- data can be partitioned by tenant and sensitivity
- storage supports replay, analytics, and rollback

