# Policy Model Design

Status: Draft v1
Owner: agent-rbac
Scope: Cross-agent, host-agnostic

## 1. Purpose

This document defines the long-term policy model for `agent-rbac`, including:

- static roles
- direct grants / denies
- resource-aware permissions
- dynamic overlays
- trust-aware review intensity

The goal is to preserve explainability while allowing adaptive behavior.

## 2. Policy Layers

The effective policy for any request is the merge of:

1. system defaults
2. tenant policy
3. role policy
4. direct user policy
5. dynamic overlay
6. temporary manual override

The precedence must be explicit and audit-safe.

## 3. Precedence Rules

Highest priority first:

1. explicit deny
2. temporary manual override
3. dynamic safety tightening
4. direct user grants
5. role grants
6. tenant defaults
7. system defaults

Notes:

- high-risk adaptive expansion must not outrank explicit deny
- owner wildcard remains a special case but should still be auditable

## 4. Policy Scopes

### 4.1 System Scope

Global defaults and reserved protected surfaces.

### 4.2 Tenant Scope

Tenant-specific defaults and protected resources.

### 4.3 Group Scope

Optional grouping of users for reusable role evolution.

### 4.4 User Scope

User-specific direct permissions, overlays, trust settings.

### 4.5 Session Scope

Short-lived overrides, temporary restrictions, active review intensity.

## 5. Permission Taxonomy

The permission model should cover five dimensions:

- interaction permissions
- tool permissions
- information visibility permissions
- policy/admin permissions
- audit/review permissions

### 5.1 Interaction

- `message.send`
- `bridge.session.*`
- `bridge.mode.*`
- `bridge.workdir.change`

### 5.2 Tool

- `agent.file.read`
- `agent.file.write`
- `agent.bash.read`
- `agent.bash.write`
- `agent.web.search`
- `agent.tool.*`

### 5.3 Information

- `info.public.memory.read`
- `info.tenant.memory.read`
- `info.own.memory.read`
- `info.own.memory.write`
- `info.others.memory.read`
- `info.others.memory.write`
- `info.agent.config.read`
- `info.agent.config.write`

### 5.4 Audit & Review

- `audit.events.read`
- `audit.events.read_sensitive`
- `audit.events.export`
- `review.decisions.write`
- `review.overrides.write`

### 5.5 Policy Management

- `policy.roles.manage`
- `policy.overlays.manage`
- `policy.approvals.write`

## 6. Resource Model

Permissions alone are not enough. Requests must also be evaluated against resources.

Resources should support:

- type
- owner
- tenant
- sensitivity
- path or ID
- tags

```ts
type ProtectedResource = {
  kind: 'file' | 'memory' | 'knowledge' | 'config' | 'api' | 'custom';
  path?: string;
  id?: string;
  ownerUserId?: string;
  ownerTenantId?: string;
  sensitivity?: 'public' | 'internal' | 'sensitive' | 'restricted';
  tags?: string[];
};
```

## 7. Effective Policy Object

```ts
type EffectivePolicy = {
  actor: {
    userId: string;
    tenantId?: string;
    effectiveRole: string;
    trustBand?: string;
  };
  permissions: string[];
  denies: string[];
  enforcedMode?: string;
  reviewIntensity?: 'low' | 'normal' | 'high';
  memoryScopes: string[];
  overlays: string[];
};
```

## 8. Role Model

Roles should remain durable and explainable.

Recommended properties:

- stable name
- human-readable description
- permissions
- denies
- max mode
- default review intensity
- default rate limit
- intended user archetype

## 9. Overlay Model

Overlays are the bridge between static policy and adaptive behavior.

Allowed overlay use cases:

- temporary tightening after probing
- low-risk read expansion after approval
- review intensity changes
- rate limit adjustments
- role experimentation before making it permanent

Overlays must always have:

- source
- createdAt
- risk tier
- approval state
- expiry if temporary

## 10. Review Intensity

The system should support review intensity as a first-class policy dimension.

Levels:

- `low`: minimal intervention
- `normal`: default protection and review
- `high`: extra scrutiny, more sampling, more alerts

This is useful when the right response is not necessarily "deny more", but "watch more closely".

## 11. Mode Policy

Mode policy should remain host-agnostic.

Requirements:

- hosts may expose different mode names
- mode hierarchy must be configurable
- effective mode must be traceable
- mode downgrade must be explicit in the decision record

## 12. Multi-Tenant Policy Design

The system must support:

- tenant-specific protected paths
- tenant-scoped memory visibility
- tenant-specific default roles
- tenant-specific adaptive overlays
- tenant-scoped audit permissions

Cross-tenant access should default to deny unless explicitly modeled and approved.

## 13. Policy Change Provenance

Every material policy element should carry provenance:

- static config
- dynamic suggestion approved
- auto low-risk tuning
- manual emergency override

This is necessary for audit and rollback.

## 14. Rollback and Safety

Any adaptive or manual policy change should be reversible.

Recommended capabilities:

- diff old vs new policy
- rollback by overlay or change ID
- simulate policy before activation

## 15. Success Criteria

The policy model succeeds when:

- it stays explainable to humans
- it supports adaptation without hidden privilege creep
- it works across multiple agents and tenants
- it can represent both strict safety and evolving trust

