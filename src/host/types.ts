export interface HostIdentity {
  userId: string;
  sessionId: string;
  agentId: string;
  tenantId?: string;
  workspaceId?: string;
  channel?: string;
  locale?: string;
  requestId?: string;
}

export interface HostMessage {
  text: string;
  command?: string;
  commandArgs?: string;
  currentMode?: string;
}

export interface HostResourceRef {
  kind: 'file' | 'memory' | 'knowledge' | 'api' | 'config' | 'custom';
  id?: string;
  path?: string;
  ownerUserId?: string;
  ownerTenantId?: string;
  sensitivity?: 'public' | 'internal' | 'sensitive' | 'restricted';
  tags?: string[];
}

export interface HostToolIntent {
  toolName: string;
  args?: Record<string, unknown>;
  resources?: HostResourceRef[];
}

export interface HostRequest {
  identity: HostIdentity;
  message: HostMessage;
  toolIntent?: HostToolIntent;
  metadata?: Record<string, unknown>;
}

export interface HostDecision {
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
}

export interface HostAdapter<
  THostRequest = unknown,
  THostTool = unknown,
  THostOutput = unknown,
> {
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
