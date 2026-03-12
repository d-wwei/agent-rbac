import type {
  HostAdapter,
  HostDecision,
  HostRequest,
  HostToolIntent,
} from '../host/types.js';
import {
  coalesceText,
  normalizeResources,
  normalizeToolName,
  parseLeadingCommand,
  type AdapterResourceInput,
} from './shared.js';

const CODEX_TOOL_ALIASES: Record<string, string> = {
  read: 'Read',
  edit: 'Edit',
  write: 'Edit',
  bash: 'Bash',
  shell: 'Bash',
  websearch: 'WebSearch',
  search_query: 'WebSearch',
};

export interface CodexRequest {
  userId?: string;
  sessionId?: string;
  agentId?: string;
  tenantId?: string;
  workspaceId?: string;
  channel?: string;
  locale?: string;
  requestId?: string;
  input?: string;
  prompt?: string;
  text?: string;
  message?: string;
  command?: string;
  commandArgs?: string;
  currentMode?: string;
  toolCall?: {
    name?: string;
    arguments?: Record<string, unknown>;
    filePaths?: string[];
    resources?: AdapterResourceInput[];
  };
  metadata?: Record<string, unknown>;
}

export class CodexAdapter implements HostAdapter<CodexRequest, CodexRequest['toolCall'], string> {
  private lastDecisionBySession = new Map<string, HostDecision>();

  async normalizeRequest(input: CodexRequest): Promise<HostRequest> {
    const text = coalesceText(input.input, input.prompt, input.text, input.message);
    const parsedCommand = input.command ?? parseLeadingCommand(text)?.command;
    const parsedArgs = input.commandArgs ?? parseLeadingCommand(text)?.args;
    const toolIntent = input.toolCall
      ? (await this.normalizeToolIntent(input.toolCall)) ?? undefined
      : undefined;

    return {
      identity: {
        userId: input.userId ?? 'unknown-user',
        sessionId: input.sessionId ?? input.requestId ?? 'unknown-session',
        agentId: input.agentId ?? 'codex',
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        channel: input.channel ?? 'codex',
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

  async normalizeToolIntent(
    input: NonNullable<CodexRequest['toolCall']>,
  ): Promise<HostToolIntent | null> {
    const toolName = normalizeToolName(input.name ?? 'unknown', CODEX_TOOL_ALIASES);
    return {
      toolName,
      args: input.arguments,
      resources: normalizeResources({
        resources: input.resources,
        filePaths: input.filePaths,
        args: input.arguments,
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
