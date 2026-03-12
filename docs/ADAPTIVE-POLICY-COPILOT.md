# Adaptive Policy Copilot Design

Status: Draft v1
Owner: agent-rbac
Scope: Cross-agent, host-agnostic

## 1. Purpose

Static RBAC is necessary but insufficient. A useful product must improve with use, align to the owner's judgment over time, and reduce configuration burden without silently taking unsafe actions.

This document defines the adaptive layer that:

- observes user behavior and policy friction
- learns owner preferences from review and feedback
- proposes better user classification and role shaping
- gradually reduces interruption while preserving safety

This layer is a copilot, not an autonomous replacement for human authority.

## 2. Product Principles

### 2.1 Learn Continuously, Escalate Carefully

- Learn from behavior continuously.
- Suggest changes proactively.
- Require explicit confirmation for high-risk expansions.

### 2.2 Separate Stable Policy from Adaptive Overlay

There must always be a durable baseline:

- static roles
- static permissions
- explicit deny rules

Adaptive behavior must be represented as an overlay, never as hidden mutation.

### 2.3 Every Adaptive Change Must Be Explainable

Any suggestion or automated adjustment must answer:

- what pattern triggered it
- what evidence supports it
- what exact policy change is proposed
- what risk tier it belongs to

### 2.4 Trust Must Be Visible

Users should perceive that the system is becoming more aligned.

The product should expose a "familiarity" or "alignment" trajectory rather than only internal scores.

## 3. Core User Jobs

### 3.1 Owner

Needs the system to:

- avoid asking repetitive questions forever
- learn preferred boundaries
- propose sensible role changes
- flag risky users early

### 3.2 Operator / Team Lead

Needs the system to:

- suggest reusable role templates
- identify clusters of similar users
- reduce review workload

### 3.3 Security Reviewer

Needs the system to:

- separate convenience tuning from security escalation
- prove which changes were human-approved
- detect risky self-reinforcing loops

## 4. Conceptual Model

The adaptive system has four layers:

1. observation
2. interpretation
3. recommendation
4. controlled activation

It does not jump directly from behavior to silent permanent permission mutation.

## 5. Inputs

The copilot learns from five classes of signal.

### 5.1 Behavior Signals

- repeated access attempts
- repeated denials
- repeated successful low-risk operations
- probing intensity
- resource category distribution
- mode usage patterns

### 5.2 Feedback Signals

- owner marks `too_strict`
- owner marks `too_permissive`
- owner confirms a review as correct
- owner manually grants after denial
- owner manually revokes after allow

### 5.3 Context Signals

- tenant
- agent type
- channel
- project / workspace
- session continuity
- time of day / recency

### 5.4 Group Signals

- many users in the same team hitting the same friction
- one cluster repeatedly requiring the same override
- one cluster probing the same protected surface

### 5.5 Outcome Signals

- accepted suggestions
- rejected suggestions
- later incidents after a granted suggestion
- reduced review rate after a change

## 6. What the System Learns

### 6.1 User Classification

Examples:

- faq_reader
- support_reader
- project_collaborator
- risky_prober
- trusted_repeat_operator

These are not necessarily final roles. They are inferred profiles.

### 6.2 Owner Preference Patterns

Examples:

- prefers generous read access for project continuity
- prefers strict write access by default
- often approves public knowledge expansion
- treats cross-user memory as always sensitive

### 6.3 Policy Friction Patterns

Examples:

- many false positives around a resource category
- a role is too broad for one subgroup
- a role is missing a common low-risk permission

## 7. Adaptive Objects

### 7.1 User Profile

```ts
type AdaptiveUserProfile = {
  userId: string;
  tenantId?: string;
  inferredLabels: string[];
  trustBand: 'unknown' | 'low' | 'medium' | 'high' | 'restricted';
  confidence: number;
  evidenceSummary: string[];
  lastUpdatedAt: string;
};
```

### 7.2 Adaptive Overlay

```ts
type AdaptiveOverlay = {
  id: string;
  scope: 'user' | 'group' | 'tenant';
  targetId: string;
  changes: {
    addPermissions?: string[];
    addDenies?: string[];
    adjustRateLimit?: number | null;
    preferredMode?: string;
    reviewIntensity?: 'low' | 'normal' | 'high';
  };
  source: 'suggested' | 'approved' | 'auto_low_risk';
  riskTier: 'low' | 'medium' | 'high';
  expiresAt?: string;
  createdAt: string;
  approvedBy?: string;
};
```

### 7.3 Suggestion

```ts
type PolicySuggestion = {
  id: string;
  targetType: 'user' | 'role' | 'group' | 'tenant';
  targetId: string;
  kind:
    | 'grant_permission'
    | 'add_deny'
    | 'create_role'
    | 'reclassify_user'
    | 'tighten_review'
    | 'loosen_review'
    | 'adjust_rate_limit';
  title: string;
  rationale: string;
  evidence: string[];
  proposedChange: Record<string, unknown>;
  riskTier: 'low' | 'medium' | 'high';
  confidence: number;
  createdAt: string;
};
```

## 8. Familiarity Model

The product should expose a user-visible growth metric.

### 8.1 Familiarity Score

`familiarityScore` is a composite measure of how aligned the system is with owner judgments in a given scope.

Possible factors:

- suggestion acceptance rate
- review reversal rate
- repeated-pattern stability
- interruption rate
- incident-free operation after policy changes
- confidence of inferred classifications

### 8.2 Familiarity States

- `learning`
- `stabilizing`
- `aligned`
- `watchful`

### 8.3 Meaning

- `learning`: system asks more often
- `stabilizing`: routine patterns are understood
- `aligned`: only edge cases prompt intervention
- `watchful`: risk behavior requires extra caution even if familiarity was previously high

## 9. Decision Policy for Adaptation

### 9.1 Safe Automation Boundaries

Low-risk actions may be auto-applied:

- explanation style tuning
- alert threshold tuning
- review intensity increase
- temporary tightening after suspicious behavior
- low-risk summarization preferences

### 9.2 Confirmation Required

Require human confirmation for:

- granting new read access to sensitive data
- any write access expansion
- cross-user or cross-tenant access
- bash / file / configuration write capability
- creation of reusable elevated roles

### 9.3 Automatic Tightening Allowed

The system may automatically tighten:

- rate limits
- review intensity
- sensitive resource scrutiny
- trust band classification

This is allowed because it reduces risk rather than increasing it.

## 10. Interaction Model

### 10.1 Early Phase

The system asks more explicitly:

- "I grouped this user as `support_reader`; is that correct?"
- "You approved the same denial override three times. Should I make this default?"

### 10.2 Mature Phase

The system asks only on boundary ambiguity:

- "I am not confident whether this should become a permanent permission. Please confirm."

### 10.3 Review-Driven Learning

Every review action should become a training signal:

- `too_strict` -> candidate loosening suggestion
- `too_permissive` -> candidate tightening suggestion
- `correct` -> confidence reinforcement

## 11. Learning Workflow

### 11.1 Observation

Collect event summaries from the audit subsystem.

### 11.2 Pattern Detection

Produce:

- repeated friction clusters
- repeated probing clusters
- repeated manual override clusters

### 11.3 Suggestion Generation

Generate explicit candidate changes with evidence and risk tier.

### 11.4 Approval / Rejection

Human chooses:

- approve
- reject
- defer
- approve temporarily

### 11.5 Activation

Approved changes become adaptive overlays or durable policy changes.

### 11.6 Evaluation

Measure whether:

- review load decreased
- error rate decreased
- risk remained controlled

## 12. Anti-Failure Guards

### 12.1 Prevent Silent Privilege Creep

The system must not silently accumulate risky permissions because of repeated owner approvals without visibility.

Guard:

- require explicit surfaced approval for medium/high risk changes
- show cumulative permission drift

### 12.2 Prevent Feedback Poisoning

Malicious users may attempt to shape policy by repeatedly probing.

Guard:

- suggestions must weigh owner review more heavily than raw user behavior
- probing behavior reduces trust instead of increasing it

### 12.3 Prevent Overfitting

One-off incidents should not cause permanent role changes.

Guard:

- require minimum evidence thresholds
- support temporary overlays before permanent edits

## 13. APIs

```ts
interface AdaptiveSignalStore {
  recordObservation(observation: AdaptiveObservation): Promise<void>;
}

interface SuggestionEngine {
  generateSuggestions(scope: SuggestionScope): Promise<PolicySuggestion[]>;
}

interface OverlayService {
  applyOverlay(overlay: AdaptiveOverlay): Promise<void>;
  expireOverlay(id: string): Promise<void>;
}

interface FamiliarityService {
  getScore(scope: FamiliarityScope): Promise<FamiliaritySnapshot>;
}
```

## 14. UX Surfaces

### 14.1 Suggestions Inbox

Shows:

- suggested role reclassifications
- repeated false-positive patterns
- risky probing alerts
- new candidate role templates

### 14.2 Familiarity Dashboard

Shows:

- familiarity score over time
- interruption rate trend
- review reversal rate trend
- trust band distribution

### 14.3 User / Group Insight Page

Shows:

- inferred labels
- recent policy friction
- approved overlays
- suggested next action

## 15. Data Dependencies on Audit System

The adaptive system depends on the audit layer for:

- reviewed decision records
- diff summaries
- risk counts
- manual override events
- accepted / rejected suggestions

Without the audit subsystem, adaptive learning should remain disabled or severely limited.

## 16. Phased Delivery

### Phase 1

- collect adaptive signals
- manual review as training input
- generate low-risk suggestions
- familiarity score prototype

### Phase 2

- group clustering
- reusable role suggestions
- temporary overlays
- risk-aware trust bands

### Phase 3

- stronger recommendation ranking
- tenant-specific preference modeling
- role evolution assistant
- regression prevention based on prior incidents

## 17. Success Metrics

- decrease in review interruption rate
- decrease in repeated identical owner decisions
- increase in accepted suggestions
- lower false-positive rate
- stable or improved risk-block rate
- owner-reported trust in automatic behavior

