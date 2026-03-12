# Implementation Roadmap

Status: Draft v1
Owner: agent-rbac
Scope: Cross-agent, host-agnostic

## 1. Purpose

This roadmap turns the product design set into an implementation sequence.

The goal is to avoid building isolated features without the product loop:

`protect -> record -> review -> learn -> protect better`

## 2. Release Phases

### Phase 0: Core Hardening

Goal:

- reliable enforcement core
- host-agnostic abstractions

Deliverables:

- core permission engine
- host contract package
- adapter interfaces
- stable policy model
- normalized resource model

### Phase 1: Black Box Foundations

Goal:

- every decision becomes replayable

Deliverables:

- decision record writer
- diff record writer
- basic audit query service
- event detail view schema
- review action model

Success bar:

- every deny and high-risk allow has a replayable trace

### Phase 2: Human Review Console

Goal:

- humans can actually inspect and correct the system

Deliverables:

- timeline view
- detail replay view
- diff view
- review states and notes
- weekly report generation

Success bar:

- owner can verify whether a decision was correct without reading raw backend logs

### Phase 3: Adaptive Signals

Goal:

- learn from behavior and feedback, but safely

Deliverables:

- observation store
- suggestion engine
- familiarity scoring
- low-risk adaptive overlays
- approval workflow for medium/high-risk suggestions

Success bar:

- repeated owner decisions start converting into suggestions

### Phase 4: First-Party Host Adapters

Goal:

- prove cross-agent integration strategy

Deliverables:

- OpenClaw adapter
- generic coding-agent adapter
- one additional brand-specific adapter
- example integration repos or examples

Success bar:

- at least two very different agent hosts use the same core

### Phase 5: Advanced Operations

Goal:

- enterprise readiness

Deliverables:

- risk heatmaps
- anomaly alerts
- incident packages
- policy diff/rollback tools
- multi-tenant operational controls

## 3. Recommended Repo Evolution

### Stage A

Current repo stays monolithic while APIs settle.

### Stage B

Split into subpackages:

- `packages/core`
- `packages/host-contract`
- `packages/audit`
- `packages/adaptive`
- `packages/adapters/openclaw`
- `packages/adapters/generic-coding-agent`

### Stage C

Optional separate console/UI repo if product surface grows independently.

## 4. Engineering Workstreams

### 4.1 Core Runtime

- normalize host request model
- merge static and dynamic policy
- resource-aware tool enforcement
- output filtering hooks

### 4.2 Audit Platform

- immutable decision recorder
- diff generation
- query and indexing strategy
- report generation

### 4.3 Review Workflow

- review state machine
- override workflow
- review-to-suggestion linkage

### 4.4 Adaptive Platform

- signal ingestion
- trust and familiarity scoring
- suggestion generation
- overlay lifecycle

### 4.5 Adapters

- host-specific field mapping
- tool/resource extraction
- output interception integration

## 5. Early API Milestones

### Milestone 1

- `HostRequest`
- `HostDecision`
- `HostAdapter`
- `EffectivePolicy`

### Milestone 2

- `DecisionRecord`
- `DiffRecord`
- `AuditRecorder`
- `ReviewInput`

### Milestone 3

- `AdaptiveUserProfile`
- `PolicySuggestion`
- `AdaptiveOverlay`
- `FamiliaritySnapshot`

## 6. Validation Strategy

Validation should happen at three levels:

### 6.1 Unit

- permission resolution
- resource matching
- overlay precedence
- diff creation

### 6.2 Integration

- host adapter to core contract
- end-to-end decision recording
- review action persistence
- suggestion generation from reviewed events

### 6.3 Product Simulation

- high-risk leakage attempts
- repeated probing
- repeated owner approvals
- weekly report generation
- familiarity score improvement over time

## 7. Launch Sequence

Recommended launch order:

1. core + audit foundation
2. review console basics
3. OpenClaw adapter
4. adaptive suggestions
5. more adapters

Reason:

- without audit, users will not trust it
- without review, adaptation is unsafe
- OpenClaw is likely the strongest initial demand
- more adapters should come after the contract proves stable

## 8. Key Risks

- overbuilding UI before core contracts stabilize
- adding adaptation before audit/review is mature
- allowing hosts to bypass interception hooks
- privilege creep from poorly bounded adaptive changes

## 9. Success Metrics

- time to integrate a new host
- percentage of protected decisions with replay traces
- owner review burden over time
- accepted suggestion rate
- reduction in repeated manual overrides
- high-risk incident detection quality

