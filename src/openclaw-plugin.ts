import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AdaptivePolicyCopilot } from './adaptive/service.js';
import { FileSystemAdaptiveStore } from './adaptive/store.js';
import { AuditService } from './audit/service.js';
import { FileSystemAuditStore } from './audit/store.js';
import { FileConfigLoader } from './config/loader.js';
import { FileSystemMemoryStore } from './memory/memory-store.js';
import { OpenClawAdapter, type OpenClawGatewayRequest } from './adapters/openclaw.js';
import { createHostPermissionAdapter } from './adapters/permission-mappers.js';
import { AgentSecurityRuntime } from './runtime/security-runtime.js';
import type { HostDecision } from './host/types.js';

type OpenClawPluginLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug?: (message: string) => void;
};

type OpenClawGatewayRespond = (
  ok: boolean,
  payload?: unknown,
  error?: { message?: string },
) => void;

type OpenClawGatewayHandlerOptions = {
  params: Record<string, unknown>;
  respond: OpenClawGatewayRespond;
};

type OpenClawSubagentRuntime = {
  run: (params: {
    sessionKey: string;
    message: string;
    extraSystemPrompt?: string;
    lane?: string;
    deliver?: boolean;
    idempotencyKey?: string;
  }) => Promise<{ runId: string }>;
  waitForRun: (params: {
    runId: string;
    timeoutMs?: number;
  }) => Promise<{ status: 'ok' | 'error' | 'timeout'; error?: string }>;
  getSessionMessages: (params: {
    sessionKey: string;
    limit?: number;
  }) => Promise<{ messages: unknown[] }>;
};

type OpenClawPluginApi = {
  pluginConfig?: Record<string, unknown>;
  logger: OpenClawPluginLogger;
  resolvePath: (input: string) => string;
  registerGatewayMethod: (
    method: string,
    handler: (options: OpenClawGatewayHandlerOptions) => Promise<void> | void,
  ) => void;
  on: (hookName: string, handler: (event: unknown, ctx: unknown) => Promise<unknown> | unknown) => void;
  runtime: {
    subagent: OpenClawSubagentRuntime;
  };
};

type OpenClawPromptHookContext = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  channelId?: string;
};

type OpenClawPromptHookEvent = {
  prompt: string;
  messages: unknown[];
};

type OpenClawToolHookContext = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
};

type OpenClawToolHookEvent = {
  toolName: string;
  params: Record<string, unknown>;
  runId?: string;
};

type OpenClawLlmOutputContext = {
  sessionKey?: string;
  sessionId?: string;
};

type OpenClawLlmOutputEvent = {
  runId: string;
  assistantTexts: string[];
};

type PluginConfig = {
  permissionsConfigPath: string;
  stateDir: string;
  locale?: string;
  promptGuard: boolean;
  toolGuard: boolean;
  gatewayMethods: boolean;
  maxSmokeSubagents: number;
  defaultUserIdStrategy: 'session-key' | 'session-id';
};

class OpenClawRbacPlugin {
  private readonly config: PluginConfig;
  private readonly auditService: AuditService;
  private readonly adaptiveCopilot: AdaptivePolicyCopilot;
  private readonly runtime: AgentSecurityRuntime<OpenClawGatewayRequest, string>;
  private readonly decisionBySession = new Map<string, HostDecision>();
  private readonly decisionByRun = new Map<string, HostDecision>();

  constructor(private readonly api: OpenClawPluginApi) {
    this.config = resolvePluginConfig(api);
    this.ensureDir(this.config.stateDir);
    this.auditService = new AuditService(
      new FileSystemAuditStore(path.join(this.config.stateDir, 'audit')),
      {
        hostType: 'openclaw',
        policyVersion: 'v1',
        runtimeVersion: 'openclaw-plugin-v1',
      },
    );
    this.adaptiveCopilot = new AdaptivePolicyCopilot(
      new FileSystemAdaptiveStore(path.join(this.config.stateDir, 'adaptive')),
    );
    this.runtime = new AgentSecurityRuntime({
      configLoader: new FileConfigLoader(this.config.permissionsConfigPath),
      hostAdapter: new OpenClawAdapter(),
      auditService: this.auditService,
      adaptiveCopilot: this.adaptiveCopilot,
      adapterPermissionMapper: createHostPermissionAdapter('openclaw'),
      pipeline: {
        locale: this.config.locale,
        contextLoaderOpts: {
          memoryStore: new FileSystemMemoryStore(path.join(this.config.stateDir, 'memory')),
        },
      },
    });
  }

  register(): void {
    this.api.on('before_prompt_build', async (event, ctx) =>
      this.handleBeforePromptBuild(
        event as OpenClawPromptHookEvent,
        ctx as OpenClawPromptHookContext,
      ),
    );
    this.api.on('before_tool_call', async (event, ctx) =>
      this.handleBeforeToolCall(
        event as OpenClawToolHookEvent,
        ctx as OpenClawToolHookContext,
      ),
    );
    this.api.on('llm_output', async (event, ctx) =>
      this.handleLlmOutput(
        event as OpenClawLlmOutputEvent,
        ctx as OpenClawLlmOutputContext,
      ),
    );

    if (this.config.gatewayMethods) {
      this.api.registerGatewayMethod('agent_rbac.evaluate', async (options) =>
        this.handleGatewayEvaluate(options),
      );
      this.api.registerGatewayMethod('agent_rbac.audit.timeline', async (options) =>
        this.handleGatewayTimeline(options),
      );
      this.api.registerGatewayMethod('agent_rbac.audit.review', async (options) =>
        this.handleGatewayReview(options),
      );
      this.api.registerGatewayMethod('agent_rbac.adaptive.suggestions', async (options) =>
        this.handleGatewaySuggestions(options),
      );
      this.api.registerGatewayMethod('agent_rbac.adaptive.familiarity', async (options) =>
        this.handleGatewayFamiliarity(options),
      );
      this.api.registerGatewayMethod('agent_rbac.smoke', async (options) =>
        this.handleGatewaySmoke(options),
      );
    }
  }

  private async handleBeforePromptBuild(
    event: OpenClawPromptHookEvent,
    ctx: OpenClawPromptHookContext,
  ): Promise<{
    prependContext?: string;
    prependSystemContext?: string;
  } | void> {
    if (!this.config.promptGuard) return;
    const request = this.buildPromptRequest(event, ctx);
    const evaluated = await this.runtime.evaluate(request);
    this.rememberDecision(evaluated.decision, {
      sessionId: request.sessionId,
      sessionKey: ctx.sessionKey,
    });

    const prependSystemContext = evaluated.decision.injectedPrompt;
    if (!evaluated.decision.allowed) {
      return {
        prependSystemContext,
        prependContext: buildRefusalInstruction(
          evaluated.decision.denialReason ?? 'Request denied by security policy.',
        ),
      };
    }

    if (!prependSystemContext) {
      return;
    }
    return { prependSystemContext };
  }

  private async handleBeforeToolCall(
    event: OpenClawToolHookEvent,
    ctx: OpenClawToolHookContext,
  ): Promise<{ block?: boolean; blockReason?: string } | void> {
    if (!this.config.toolGuard) return;
    const request = this.buildToolRequest(event, ctx);
    const evaluated = await this.runtime.evaluate(request);
    this.rememberDecision(evaluated.decision, {
      runId: event.runId,
      sessionId: request.sessionId,
      sessionKey: ctx.sessionKey,
    });
    if (evaluated.decision.allowed) {
      return;
    }
    return {
      block: true,
      blockReason:
        evaluated.decision.denialReason ?? 'Tool call blocked by agent-rbac policy.',
    };
  }

  private async handleLlmOutput(
    event: OpenClawLlmOutputEvent,
    ctx: OpenClawLlmOutputContext,
  ): Promise<void> {
    const decision = this.lookupDecision({
      runId: event.runId,
      sessionId: ctx.sessionId,
      sessionKey: ctx.sessionKey,
    });
    if (!decision?.traceId) {
      return;
    }
    const candidate = event.assistantTexts.join('\n').trim();
    if (!candidate) {
      return;
    }
    const finalOutput = !decision.allowed && decision.denialReason
      ? decision.denialReason
      : candidate;
    await this.auditService.attachOutputDecision({
      decisionId: decision.traceId,
      candidateOutput: candidate,
      finalOutput,
      reason: !decision.allowed
        ? decision.denialReason
        : 'Observed OpenClaw llm_output event.',
    });
  }

  private async handleGatewayEvaluate(
    options: OpenClawGatewayHandlerOptions,
  ): Promise<void> {
    const request = asRecord(options.params.request);
    if (!request) {
      options.respond(false, undefined, { message: 'params.request must be an object.' });
      return;
    }
    const result = await this.runtime.evaluate(request as OpenClawGatewayRequest);
    options.respond(true, result);
  }

  private async handleGatewayTimeline(
    options: OpenClawGatewayHandlerOptions,
  ): Promise<void> {
    const params = asRecord(options.params) ?? {};
    const decisions = await this.auditService.listTimeline({
      userId: asOptionalString(params.userId),
      tenantId: asOptionalString(params.tenantId),
      sessionId: asOptionalString(params.sessionId),
      agentId: asOptionalString(params.agentId),
      kind: asOptionalKind(params.kind),
      startDate: asOptionalString(params.startDate),
      endDate: asOptionalString(params.endDate),
      limit: asOptionalNumber(params.limit),
    });
    options.respond(true, { decisions });
  }

  private async handleGatewayReview(
    options: OpenClawGatewayHandlerOptions,
  ): Promise<void> {
    const params = asRecord(options.params) ?? {};
    const decisionId = asOptionalString(params.decisionId);
    const reviewerId = asOptionalString(params.reviewerId);
    const status = asOptionalString(params.status);
    if (!decisionId || !reviewerId || !status) {
      options.respond(false, undefined, {
        message: 'decisionId, reviewerId, and status are required.',
      });
      return;
    }
    await this.runtime.reviewDecision({
      decisionId,
      reviewerId,
      status: status as 'correct' | 'too_strict' | 'too_permissive' | 'policy_bug' | 'adapter_bug',
      note: asOptionalString(params.note),
    });
    options.respond(true, { ok: true });
  }

  private async handleGatewaySuggestions(
    options: OpenClawGatewayHandlerOptions,
  ): Promise<void> {
    const params = asRecord(options.params) ?? {};
    const suggestions = await this.adaptiveCopilot.getSuggestions(
      asOptionalString(params.userId),
    );
    options.respond(true, { suggestions });
  }

  private async handleGatewayFamiliarity(
    options: OpenClawGatewayHandlerOptions,
  ): Promise<void> {
    const params = asRecord(options.params) ?? {};
    const userId = asOptionalString(params.userId);
    if (!userId) {
      options.respond(false, undefined, { message: 'userId is required.' });
      return;
    }
    const familiarity = await this.adaptiveCopilot.getFamiliarity(userId);
    options.respond(true, { familiarity });
  }

  private async handleGatewaySmoke(
    options: OpenClawGatewayHandlerOptions,
  ): Promise<void> {
    const params = asRecord(options.params) ?? {};
    const requests = Array.isArray(params.requests)
      ? params.requests.filter((value): value is OpenClawGatewayRequest => isObject(value))
      : [];
    const subagents = Array.isArray(params.subagents)
      ? params.subagents.filter((value): value is Record<string, unknown> => isObject(value))
      : [];
    if (subagents.length > this.config.maxSmokeSubagents) {
      options.respond(false, undefined, {
        message: `subagents exceeds maxSmokeSubagents=${this.config.maxSmokeSubagents}`,
      });
      return;
    }

    const requestResults = [];
    for (const request of requests) {
      requestResults.push(await this.runtime.evaluate(request));
    }

    const subagentResults = [];
    for (const item of subagents) {
      const sessionKey = asOptionalString(item.sessionKey);
      const message = asOptionalString(item.message);
      if (!sessionKey || !message) {
        continue;
      }
      const started = await this.api.runtime.subagent.run({
        sessionKey,
        message,
        extraSystemPrompt: asOptionalString(item.extraSystemPrompt),
        lane: asOptionalString(item.lane),
        deliver: item.deliver === true,
        idempotencyKey: asOptionalString(item.idempotencyKey) ?? randomUUID(),
      });
      const waited = await this.api.runtime.subagent.waitForRun({
        runId: started.runId,
        timeoutMs: asOptionalNumber(item.timeoutMs) ?? 30_000,
      });
      const transcript = await this.api.runtime.subagent.getSessionMessages({
        sessionKey,
        limit: asOptionalNumber(item.messageLimit) ?? 12,
      });
      subagentResults.push({
        sessionKey,
        runId: started.runId,
        status: waited.status,
        error: waited.error,
        messageCount: transcript.messages.length,
        lastMessage: transcript.messages.at(-1) ?? null,
      });
    }

    options.respond(true, {
      requestResults,
      subagentResults,
    });
  }

  private buildPromptRequest(
    event: OpenClawPromptHookEvent,
    ctx: OpenClawPromptHookContext,
  ): OpenClawGatewayRequest {
    return {
      userId: this.resolveUserId(ctx),
      sessionId: ctx.sessionId ?? ctx.sessionKey ?? 'unknown-session',
      agentId: ctx.agentId ?? 'openclaw',
      workspaceId: ctx.workspaceDir,
      channel: ctx.channelId ?? 'openclaw',
      locale: this.config.locale,
      requestId: ctx.sessionId ?? ctx.sessionKey,
      text: event.prompt,
    };
  }

  private buildToolRequest(
    event: OpenClawToolHookEvent,
    ctx: OpenClawToolHookContext,
  ): OpenClawGatewayRequest {
    return {
      userId: this.resolveUserId(ctx),
      sessionId: ctx.sessionId ?? ctx.sessionKey ?? 'unknown-session',
      agentId: ctx.agentId ?? 'openclaw',
      channel: 'openclaw',
      locale: this.config.locale,
      requestId: event.runId ?? ctx.sessionId ?? ctx.sessionKey,
      text: `[tool] ${event.toolName}`,
      toolCall: {
        toolName: event.toolName,
        args: event.params,
      },
    };
  }

  private resolveUserId(
    ctx: Pick<OpenClawPromptHookContext & OpenClawToolHookContext, 'sessionKey' | 'sessionId'>,
  ): string {
    if (this.config.defaultUserIdStrategy === 'session-id' && ctx.sessionId) {
      return ctx.sessionId;
    }
    return ctx.sessionKey ?? ctx.sessionId ?? 'unknown-user';
  }

  private rememberDecision(
    decision: HostDecision,
    ids: { runId?: string; sessionId?: string; sessionKey?: string },
  ): void {
    if (ids.runId) {
      this.decisionByRun.set(ids.runId, decision);
    }
    for (const sessionId of [ids.sessionId, ids.sessionKey]) {
      if (!sessionId) continue;
      this.decisionBySession.set(sessionId, decision);
    }
  }

  private lookupDecision(ids: {
    runId?: string;
    sessionId?: string;
    sessionKey?: string;
  }): HostDecision | null {
    if (ids.runId && this.decisionByRun.has(ids.runId)) {
      return this.decisionByRun.get(ids.runId) ?? null;
    }
    for (const sessionId of [ids.sessionId, ids.sessionKey]) {
      if (!sessionId) continue;
      const decision = this.decisionBySession.get(sessionId);
      if (decision) {
        return decision;
      }
    }
    return null;
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function resolvePluginConfig(api: OpenClawPluginApi): PluginConfig {
  const value = api.pluginConfig ?? {};
  const permissionsConfigPath = api.resolvePath(asOptionalString(value.permissionsConfigPath) ?? '');
  const stateDir = api.resolvePath(
    asOptionalString(value.stateDir) ?? '~/.openclaw/agent-rbac-state',
  );
  if (!permissionsConfigPath) {
    throw new Error('agent-rbac plugin requires pluginConfig.permissionsConfigPath');
  }
  return {
    permissionsConfigPath,
    stateDir,
    locale: asOptionalString(value.locale) ?? 'zh-CN',
    promptGuard: value.promptGuard !== false,
    toolGuard: value.toolGuard !== false,
    gatewayMethods: value.gatewayMethods !== false,
    maxSmokeSubagents: asOptionalNumber(value.maxSmokeSubagents) ?? 4,
    defaultUserIdStrategy:
      value.defaultUserIdStrategy === 'session-id' ? 'session-id' : 'session-key',
  };
}

function buildRefusalInstruction(reason: string): string {
  return [
    'Security boundary for this turn:',
    `- The request is denied.`,
    `- Reason: ${reason}`,
    '- Respond briefly, explain the boundary, and do not reveal protected content.',
  ].join('\n');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!isObject(value)) return null;
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asOptionalKind(value: unknown):
  | 'request'
  | 'tool_call'
  | 'memory_load'
  | 'output_filter'
  | undefined {
  return value === 'request' ||
    value === 'tool_call' ||
    value === 'memory_load' ||
    value === 'output_filter'
    ? value
    : undefined;
}

const plugin = {
  id: 'agent-rbac',
  name: 'agent-rbac',
  description: 'Adaptive RBAC, audit trail, and trust copilot for OpenClaw',
  register(api: OpenClawPluginApi) {
    const integration = new OpenClawRbacPlugin(api);
    integration.register();
    const pluginConfig = resolvePluginConfig(api);
    api.logger.info(
      `[agent-rbac] loaded with permissions config ${pluginConfig.permissionsConfigPath}`,
    );
  },
};

export default plugin;
