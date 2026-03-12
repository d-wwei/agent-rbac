import type { HostAdapter, HostDecision, HostRequest, HostResourceRef, HostToolIntent } from '../host/types.js';
import {
  coalesceText,
  normalizeResources,
  normalizeToolName,
  parseLeadingCommand,
} from './shared.js';

export interface OpenClawGatewayRequest {
  userId?: string;
  sessionId?: string;
  agentId?: string;
  tenantId?: string;
  workspaceId?: string;
  channel?: string;
  locale?: string;
  requestId?: string;
  text?: string;
  message?: string;
  command?: string;
  commandArgs?: string;
  currentMode?: string;
  toolCall?: {
    toolName?: string;
    args?: Record<string, unknown>;
    filePaths?: string[];
    resources?: Array<{
      kind?: HostResourceRef['kind'];
      id?: string;
      path?: string;
      ownerUserId?: string;
      ownerTenantId?: string;
      sensitivity?: HostResourceRef['sensitivity'];
      tags?: string[];
    }>;
  };
  metadata?: Record<string, unknown>;
}

export class OpenClawAdapter implements HostAdapter<OpenClawGatewayRequest> {
  private lastDecisionBySession = new Map<string, HostDecision>();

  async normalizeRequest(input: OpenClawGatewayRequest): Promise<HostRequest> {
    const text = coalesceText(input.text, input.message);
    const parsedCommand = input.command ?? parseLeadingCommand(text)?.command;
    const parsedArgs = input.commandArgs ?? parseLeadingCommand(text)?.args;
    const toolIntent = input.toolCall ? (await this.normalizeToolIntent(input.toolCall)) ?? undefined : undefined;

    return {
      identity: {
        userId: input.userId ?? 'unknown-user',
        sessionId: input.sessionId ?? input.requestId ?? 'unknown-session',
        agentId: input.agentId ?? 'openclaw',
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        channel: input.channel ?? 'openclaw-gateway',
        locale: input.locale,
        requestId: input.requestId,
      },
      message: {
        text,
        command: parsedCommand,
        commandArgs: parsedArgs,
        currentMode: input.currentMode,
      },
      toolIntent,
      metadata: input.metadata,
    };
  }

  async normalizeToolIntent(input: NonNullable<OpenClawGatewayRequest['toolCall']>): Promise<HostToolIntent | null> {
    return {
      toolName: normalizeToolName(input.toolName ?? 'unknown', {
        read: 'Read',
        'file.read': 'Read',
        edit: 'Edit',
        write: 'Edit',
        'file.write': 'Edit',
        bash: 'Bash',
        exec: 'Bash',
        shell: 'Bash',
        websearch: 'WebSearch',
        search: 'WebSearch',
      }),
      args: input.args,
      resources: normalizeResources({
        resources: input.resources,
        filePaths: input.filePaths,
        args: input.args,
      }),
    };
  }

  async applyDecisionToHostContext(
    request: HostRequest,
    decision: HostDecision,
  ): Promise<void> {
    this.lastDecisionBySession.set(request.identity.sessionId, decision);
  }

  getLastDecision(sessionId: string): HostDecision | null {
    return this.lastDecisionBySession.get(sessionId) ?? null;
  }

  async finalizeOutput(output: string, decision: HostDecision): Promise<string> {
    if (!decision.allowed && decision.denialReason) {
      return decision.denialReason;
    }
    return output;
  }
}
