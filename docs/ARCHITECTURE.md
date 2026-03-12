# Product Architecture

Status: Draft v1
Owner: agent-rbac
Scope: Cross-agent, host-agnostic

## 1. Product Definition

`agent-rbac` is no longer defined as a static RBAC library.

It is a cross-agent security system with four product loops:

1. protection
2. recording
3. review
4. learning

Its purpose is to help any agent operating in multi-user or multi-tenant environments prevent leakage, expose its decisions to humans, and improve through feedback over time.

## 2. Product Flywheel

The system is built around a single product flywheel:

`protect -> record -> review -> feedback -> learn -> protect better`

### 2.1 Why This Matters

- without protection, the product is unsafe
- without recording, the product is a black box
- without review, humans cannot verify it
- without feedback, it never becomes aligned
- without learning, it stays burdensome and replaceable

## 3. Position in the Stack

`agent-rbac` does not own IM bridges, customer-service integrations, or generic transport.

It sits inside each agent host runtime:

`IM /客服平台 / Web / API -> agent host with agent-rbac -> LLM runtime -> tools / memory / filesystem`

Examples of agent hosts:

- OpenClaw
- Claude-style coding agent
- Codex-style coding agent
- Gemini-style agent
- custom enterprise support agent

## 4. Architectural Layers

The system is composed of six logical layers.

### 4.1 Host Contract Layer

Defines what the host must provide:

- actor identity
- session identity
- tenant/workspace identity
- message / command context
- tool/resource intent
- response interception points

### 4.2 Enforcement Layer

Executes:

- permission checks
- deny precedence
- mode restrictions
- context isolation
- tool/path interception
- response rewriting / denial

### 4.3 Audit Layer

Records:

- normalized request
- policy matches
- memory inclusion/exclusion
- tool decisions
- output diffs
- provenance and responsibility

### 4.4 Review Layer

Allows humans to:

- replay a decision
- mark it correct or incorrect
- trace causality
- override or escalate

### 4.5 Adaptive Layer

Learns from:

- repeated user behavior
- owner feedback
- review outcomes
- friction and risk patterns

### 4.6 Policy Storage Layer

Stores:

- static roles and permissions
- dynamic overlays
- audit records
- feedback events
- familiarity state

## 5. Major Product Modules

### 5.1 Protection Engine

Runtime responsibilities:

- input normalization handoff
- user resolution
- effective policy resolution
- memory scope resolution
- tool permission enforcement
- path/resource protection
- response filtering

### 5.2 Black Box Recorder

Responsibilities:

- immutable decision records
- multi-artifact diffs
- timeline aggregation
- risk statistics

### 5.3 Review Console

Responsibilities:

- inspection and replay
- human review actions
- issue attribution
- reports and alerts

### 5.4 Adaptive Policy Copilot

Responsibilities:

- user classification
- trust/familiarity estimation
- policy suggestions
- temporary overlays
- escalation to humans

## 6. Core Runtime Flow

Per request:

1. host normalizes incoming request
2. agent-rbac resolves identity and context
3. static policy is applied
4. adaptive overlays are merged
5. memory scope is narrowed
6. prompt / mode restrictions are applied
7. tool calls are intercepted
8. response is filtered or denied if necessary
9. decision record is written
10. optional alerts / review tasks / learning signals are emitted

## 7. Cross-Agent Strategy

The architecture must preserve flexibility for future agents.

### 7.1 Stable Core

The following remain host-agnostic:

- permission model
- policy evaluation
- audit model
- feedback model
- adaptive overlay model

### 7.2 Thin Host Adapters

Per-host adapters should only translate:

- identity fields
- command format
- mode format
- tool names
- resource paths / resource IDs
- interception hooks

### 7.3 No Transport Ownership

The project must not become an IM bridge or customer-service connector product.

It may define required input fields, but transport implementation stays outside scope.

## 8. Key Non-Functional Requirements

### 8.1 Fail Closed

If identity or resource information is incomplete:

- do not silently allow risky operations
- reduce permissions or deny
- avoid loading sensitive memory

### 8.2 Explainable by Design

Every runtime decision must be reviewable after the fact.

### 8.3 Safe Adaptation

Adaptive behavior must not silently create high-risk privilege expansion.

### 8.4 Tenant Isolation

The architecture must support tenant-scoped policy, tenant-scoped memory, tenant-scoped audit, and tenant-scoped review.

## 9. Package Direction

Recommended package split:

- `agent-rbac-core`
- `agent-rbac-host-contract`
- `agent-rbac-audit`
- `agent-rbac-adaptive`
- `agent-rbac-adapters/*`

This allows:

- stable core APIs
- host-specific adapters
- future UI / console separation

## 10. Success Criteria

The architecture is successful when:

- a new host can integrate with a thin adapter
- a human can replay any high-risk event
- owner feedback measurably reduces repeated friction
- the product becomes more aligned over time without sacrificing safety

