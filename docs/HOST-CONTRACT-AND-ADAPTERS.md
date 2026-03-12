# Host Contract & Adapter Architecture

Status: Draft v1
Owner: agent-rbac
Scope: Cross-agent, host-agnostic

## 1. Purpose

`agent-rbac` must work across OpenClaw, Claude-like agents, Codex-like agents, Gemini-like agents, and future hosts without owning their transport or runtime.

This document defines:

- the minimum information a host must provide
- the normalized request contract
- the adapter responsibilities
- failure behavior when required information is missing

## 2. Design Principles

### 2.1 Core Is Stable, Adapters Are Thin

The host adapter should be a translation layer, not a second policy engine.

### 2.2 Minimum Contract, Maximum Flexibility

The contract should require only what is needed for safe enforcement, while leaving room for hosts with richer metadata.

### 2.3 No Hidden Bypass

Any tool execution, memory access, or output filtering step that can bypass the adapter contract invalidates protection guarantees.

## 3. Integration Boundary

The host is responsible for:

- receiving external requests
- authenticating / identifying users if applicable
- creating stable IDs
- exposing tool call interception points
- exposing output post-processing points

`agent-rbac` is responsible for:

- evaluating permissions
- defining allowed context
- deciding what to filter / deny / rewrite
- recording the decision

## 4. Required Information

### 4.1 Mandatory

A host must provide:

- stable `userId`
- stable `sessionId`
- `agentId` or runtime identity
- raw message text or equivalent input
- command name and args if command semantics exist
- tool name for any tool execution
- resource paths or resource IDs for protected operations

Without these, safe enforcement is impossible.

### 4.2 Strongly Recommended

- `tenantId`
- `workspaceId`
- `channel`
- `requestId`
- `currentMode`
- locale
- resource ownership metadata

These are required for strong enterprise-grade isolation.

## 5. Normalized Contract

```ts
type HostIdentity = {
  userId: string;
  sessionId: string;
  agentId: string;
  tenantId?: string;
  workspaceId?: string;
  channel?: string;
  locale?: string;
  requestId?: string;
};

type HostMessage = {
  text: string;
  command?: string;
  commandArgs?: string;
  currentMode?: string;
};

type HostResourceRef = {
  kind: 'file' | 'memory' | 'knowledge' | 'api' | 'custom';
  id?: string;
  path?: string;
  ownerUserId?: string;
  ownerTenantId?: string;
  sensitivity?: 'public' | 'internal' | 'sensitive' | 'restricted';
};

type HostToolIntent = {
  toolName: string;
  args?: Record<string, unknown>;
  resources?: HostResourceRef[];
};

type HostRequest = {
  identity: HostIdentity;
  message: HostMessage;
  toolIntent?: HostToolIntent;
  metadata?: Record<string, unknown>;
};
```

## 6. Decision Output Contract

```ts
type HostDecision = {
  allowed: boolean;
  enforcedMode?: string;
  denialCode?: string;
  denialReason?: string;
  injectedPrompt?: string;
  loadedMemorySummary?: Record<string, unknown>;
  allowedToolResources?: HostResourceRef[];
  rewrittenOutputPolicy?: {
    redactSensitive: boolean;
    rewriteBoundaryExplanations: boolean;
  };
  traceId?: string;
};
```

## 7. Adapter Responsibilities

Each adapter should implement five things:

### 7.1 Identity Mapping

Map host-native identities to stable `HostIdentity`.

### 7.2 Command Mapping

Map host-native commands to:

- `command`
- `commandArgs`
- requested mode if relevant

### 7.3 Tool Mapping

Map host-native tool names and payloads to:

- normalized tool names
- required permissions
- resource refs

### 7.4 Memory Hooking

Provide a way to:

- pass loaded memory to the host
- prevent host from loading unauthorized memory outside the contract

### 7.5 Output Hooking

Provide a hook before the final response leaves the agent so `agent-rbac` can:

- deny
- redact
- rewrite explanations
- record final diff

## 8. Adapter Interface

```ts
interface HostAdapter<THostRequest = unknown, THostTool = unknown, THostOutput = unknown> {
  normalizeRequest(input: THostRequest): Promise<HostRequest>;
  normalizeToolIntent?(input: THostTool): Promise<HostToolIntent | null>;
  extractCandidateOutput?(output: THostOutput): Promise<string | null>;
  applyDecisionToHostContext(
    request: HostRequest,
    decision: HostDecision,
  ): Promise<void>;
  finalizeOutput?(
    output: THostOutput,
    decision: HostDecision,
  ): Promise<THostOutput>;
}
```

## 9. Required Host Hook Points

Any host that wants meaningful protection must expose these hooks:

1. before model invocation
2. before tool execution
3. after candidate output generation
4. after human review feedback if supported

Without these hook points, protection becomes partial.

## 10. Failure Rules

### 10.1 Missing Identity

If `userId` or `sessionId` is missing:

- do not load private memory
- do not allow sensitive tools
- downgrade to minimal permissions or deny

### 10.2 Missing Resource Metadata

If a tool call has no path or resource identity:

- do not allow sensitive or write-capable operations
- require explicit adapter support

### 10.3 Missing Output Hook

If a host cannot intercept output before it leaves the system:

- document that output protection is incomplete
- retain audit warnings

## 11. Recommended Built-In Adapters

Priority order:

- OpenClaw adapter
- generic coding-agent adapter
- Claude-style adapter
- Codex-style adapter
- Gemini-style adapter

The goal is not to hardcode brand behavior into core, but to provide practical first-party examples.

## 12. Out of Scope

The adapter system does not include:

- IM bridge implementation
- CRM / customer-service connector implementation
- authentication provider implementation
- transport retry logic
- generic workflow orchestration

## 13. Success Criteria

This design succeeds when:

- a host can integrate with a thin adapter
- all risky operations pass through required hooks
- missing data causes safe degradation, not silent bypass
- future agents can be added without rewriting the core

