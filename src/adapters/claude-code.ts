import type {
  HostAdapter,
  HostDecision,
  HostRequest,
  HostResourceRef,
  HostToolIntent,
} from '../host/types.js';
import {
  coalesceText,
  normalizeResources,
  normalizeToolName,
  parseLeadingCommand,
  type AdapterResourceInput,
} from './shared.js';

const CLAUDE_TOOL_ALIASES: Record<string, string> = {
  read: 'Read',
  ls: 'LS',
  glob: 'Glob',
  grep: 'Grep',
  edit: 'Edit',
  write: 'Write',
  multiedit: 'MultiEdit',
  bash: 'Bash',
  webfetch: 'WebFetch',
  websearch: 'WebSearch',
};

export interface ClaudeCodeRequest {
  userId?: string;
  sessionId?: string;
  agentId?: string;
  tenantId?: string;
  workspaceId?: string;
  channel?: string;
  locale?: string;
  requestId?: string;
  prompt?: string;
  text?: string;
  message?: string;
  command?: string;
  commandArgs?: string;
  currentMode?: string;
  toolUse?: {
    name?: string;
    input?: Record<string, unknown>;
    filePaths?: string[];
    resources?: AdapterResourceInput[];
  };
  metadata?: Record<string, unknown>;
}

export class ClaudeCodeAdapter implements HostAdapter<ClaudeCodeRequest, ClaudeCodeRequest['toolUse'], string> {
  private lastDecisionBySession = new Map<string, HostDecision>();

  async normalizeRequest(input: ClaudeCodeRequest): Promise<HostRequest> {
    const text = coalesceText(input.prompt, input.text, input.message);
    const parsedCommand = input.command ?? parseLeadingCommand(text)?.command;
    const parsedArgs = input.commandArgs ?? parseLeadingCommand(text)?.args;
    const toolIntent = input.toolUse
      ? (await this.normalizeToolIntent(input.toolUse)) ?? undefined
      : undefined;

    return {
      identity: {
        userId: input.userId ?? 'unknown-user',
        sessionId: input.sessionId ?? input.requestId ?? 'unknown-session',
        agentId: input.agentId ?? 'claude-code',
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        channel: input.channel ?? 'claude-code',
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
    input: NonNullable<ClaudeCodeRequest['toolUse']>,
  ): Promise<HostToolIntent | null> {
    const toolName = normalizeToolName(input.name ?? 'unknown', CLAUDE_TOOL_ALIASES);
    return {
      toolName,
      args: input.input,
      resources: normalizeResources({
        resources: input.resources,
        filePaths: input.filePaths,
        args: input.input,
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

export type { HostResourceRef };
