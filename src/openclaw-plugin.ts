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

type OpenClawSessionOrigin = {
  provider?: string;
  from?: string;
  to?: string;
  accountId?: string;
  threadId?: string | number;
};

type OpenClawSessionDeliveryContext = {
  channel?: string;
  accountId?: string;
  threadId?: string | number;
};

type OpenClawSessionEntry = {
  sessionId?: string;
  channel?: string;
  lastChannel?: string;
  lastAccountId?: string;
  lastThreadId?: string | number;
  origin?: OpenClawSessionOrigin;
  deliveryContext?: OpenClawSessionDeliveryContext;
};

type ResolvedOpenClawIdentity = {
  userId: string;
  tenantId?: string;
  metadata: Record<string, unknown>;
};

type PluginConfig = {
  permissionsConfigPath: string;
  stateDir: string;
  openClawStateDir: string;
  sessionStorePath?: string;
  locale?: string;
  promptGuard: boolean;
  toolGuard: boolean;
  gatewayMethods: boolean;
  maxSmokeSubagents: number;
  defaultUserIdStrategy: 'session-origin' | 'session-key' | 'session-id';
};

class OpenClawRbacPlugin {
  private readonly config: PluginConfig;
  private readonly auditService: AuditService;
  private readonly adaptiveCopilot: AdaptivePolicyCopilot;
  private readonly runtime: AgentSecurityRuntime<OpenClawGatewayRequest, string>;
  private readonly decisionBySession = new Map<string, HostDecision>();
  private readonly decisionByRun = new Map<string, HostDecision>();
  private readonly sessionStoreCache = new Map<string, {
    mtimeMs: number;
    entries: Record<string, OpenClawSessionEntry>;
  }>();

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
    const identity = this.resolveIdentity(ctx);
    const parsedCommand = extractOpenClawCommand(event.prompt);
    return {
      userId: identity.userId,
      sessionId: ctx.sessionId ?? ctx.sessionKey ?? 'unknown-session',
      agentId: ctx.agentId ?? 'openclaw',
      tenantId: identity.tenantId,
      workspaceId: ctx.workspaceDir,
      channel: ctx.channelId ?? 'openclaw',
      locale: this.config.locale,
      requestId: ctx.sessionId ?? ctx.sessionKey,
      text: event.prompt,
      command: parsedCommand?.command,
      commandArgs: parsedCommand?.args,
      metadata: {
        openclawIdentity: identity.metadata,
      },
    };
  }

  private buildToolRequest(
    event: OpenClawToolHookEvent,
    ctx: OpenClawToolHookContext,
  ): OpenClawGatewayRequest {
    const identity = this.resolveIdentity(ctx);
    return {
      userId: identity.userId,
      sessionId: ctx.sessionId ?? ctx.sessionKey ?? 'unknown-session',
      agentId: ctx.agentId ?? 'openclaw',
      tenantId: identity.tenantId,
      channel: 'openclaw',
      locale: this.config.locale,
      requestId: event.runId ?? ctx.sessionId ?? ctx.sessionKey,
      text: `[tool] ${event.toolName}`,
      toolCall: {
        toolName: event.toolName,
        args: event.params,
      },
      metadata: {
        openclawIdentity: identity.metadata,
      },
    };
  }

  private resolveIdentity(
    ctx: Pick<OpenClawPromptHookContext & OpenClawToolHookContext, 'agentId' | 'sessionKey' | 'sessionId'>,
  ): ResolvedOpenClawIdentity {
    if (this.config.defaultUserIdStrategy === 'session-origin') {
      const derived = this.resolveSessionOriginIdentity(ctx);
      if (derived) {
        return derived;
      }
    }

    const userId = this.resolveFallbackUserId(ctx);
    return {
      userId,
      metadata: {
        strategy: this.config.defaultUserIdStrategy,
        source: 'fallback',
        sessionId: ctx.sessionId,
        sessionKey: ctx.sessionKey,
      },
    };
  }

  private resolveSessionOriginIdentity(
    ctx: Pick<OpenClawPromptHookContext & OpenClawToolHookContext, 'agentId' | 'sessionKey' | 'sessionId'>,
  ): ResolvedOpenClawIdentity | null {
    const sessionKey = asOptionalString(ctx.sessionKey);
    if (!sessionKey) {
      return null;
    }
    const entry = this.lookupSessionEntry(sessionKey, ctx.agentId);
    if (!entry) {
      return null;
    }

    const provider = normalizeIdentitySegment(
      entry.origin?.provider ?? entry.deliveryContext?.channel ?? entry.lastChannel ?? entry.channel,
    );
    if (!provider) {
      return null;
    }
    const accountId = normalizeIdentitySegment(
      entry.origin?.accountId ?? entry.deliveryContext?.accountId ?? entry.lastAccountId,
    );
    const actor = normalizeIdentitySegment(
      stripProviderPrefix(entry.origin?.from ?? entry.origin?.to, provider),
    );
    const threadId = normalizeIdentitySegment(
      entry.origin?.threadId ?? entry.deliveryContext?.threadId ?? entry.lastThreadId,
    );

    let userId: string | null = null;
    if (actor) {
      userId = accountId
        ? `external:${provider}:account:${accountId}:actor:${actor}`
        : `external:${provider}:actor:${actor}`;
    } else if (threadId) {
      userId = accountId
        ? `external:${provider}:account:${accountId}:thread:${threadId}`
        : `external:${provider}:thread:${threadId}`;
    }

    if (!userId) {
      return null;
    }

    const tenantId = accountId
      ? `external-tenant:${provider}:${accountId}`
      : `external-tenant:${provider}`;

    return {
      userId,
      tenantId,
      metadata: {
        strategy: 'session-origin',
        source: 'openclaw-session-store',
        provider,
        accountId,
        actor,
        threadId,
        sessionId: entry.sessionId ?? ctx.sessionId,
        sessionKey,
      },
    };
  }

  private resolveFallbackUserId(
    ctx: Pick<OpenClawPromptHookContext & OpenClawToolHookContext, 'sessionKey' | 'sessionId'>,
  ): string {
    if (this.config.defaultUserIdStrategy === 'session-key') {
      return ctx.sessionKey ?? ctx.sessionId ?? 'unknown-user';
    }
    if (ctx.sessionId) {
      return ctx.sessionId;
    }
    return ctx.sessionKey ?? 'unknown-user';
  }

  private lookupSessionEntry(
    sessionKey: string,
    agentId?: string,
  ): OpenClawSessionEntry | null {
    const storePath = this.resolveSessionStorePath(agentId);
    if (!fs.existsSync(storePath)) {
      return null;
    }

    try {
      const stat = fs.statSync(storePath);
      const cached = this.sessionStoreCache.get(storePath);
      let entries = cached?.entries;
      if (!entries || cached?.mtimeMs !== stat.mtimeMs) {
        entries = this.readSessionStoreEntries(storePath);
        this.sessionStoreCache.set(storePath, { mtimeMs: stat.mtimeMs, entries });
      }
      return entries[normalizeSessionStoreKey(sessionKey)] ?? null;
    } catch {
      return null;
    }
  }

  private readSessionStoreEntries(
    storePath: string,
  ): Record<string, OpenClawSessionEntry> {
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) {
      return {};
    }

    const entries: Record<string, OpenClawSessionEntry> = {};
    for (const [sessionKey, value] of Object.entries(parsed)) {
      if (!isObject(value)) {
        continue;
      }
      entries[normalizeSessionStoreKey(sessionKey)] = {
        sessionId: asOptionalString(value.sessionId),
        channel: asOptionalString(value.channel),
        lastChannel: asOptionalString(value.lastChannel),
        lastAccountId: asOptionalString(value.lastAccountId),
        lastThreadId: asOptionalStringOrNumber(value.lastThreadId),
        origin: isObject(value.origin)
          ? {
              provider: asOptionalString(value.origin.provider),
              from: asOptionalString(value.origin.from),
              to: asOptionalString(value.origin.to),
              accountId: asOptionalString(value.origin.accountId),
              threadId: asOptionalStringOrNumber(value.origin.threadId),
            }
          : undefined,
        deliveryContext: isObject(value.deliveryContext)
          ? {
              channel: asOptionalString(value.deliveryContext.channel),
              accountId: asOptionalString(value.deliveryContext.accountId),
              threadId: asOptionalStringOrNumber(value.deliveryContext.threadId),
            }
          : undefined,
      };
    }
    return entries;
  }

  private resolveSessionStorePath(agentId?: string): string {
    if (this.config.sessionStorePath) {
      return this.config.sessionStorePath;
    }
    return path.join(
      this.config.openClawStateDir,
      'agents',
      normalizeAgentId(agentId ?? 'main'),
      'sessions',
      'sessions.json',
    );
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
  const openClawStateDir = api.resolvePath(
    asOptionalString(value.openClawStateDir) ?? '~/.openclaw',
  );
  const sessionStorePath = asOptionalString(value.sessionStorePath)
    ? api.resolvePath(asOptionalString(value.sessionStorePath) ?? '')
    : undefined;
  if (!permissionsConfigPath) {
    throw new Error('agent-rbac plugin requires pluginConfig.permissionsConfigPath');
  }
  return {
    permissionsConfigPath,
    stateDir,
    openClawStateDir,
    sessionStorePath,
    locale: asOptionalString(value.locale) ?? 'zh-CN',
    promptGuard: value.promptGuard !== false,
    toolGuard: value.toolGuard !== false,
    gatewayMethods: value.gatewayMethods !== false,
    maxSmokeSubagents: asOptionalNumber(value.maxSmokeSubagents) ?? 4,
    defaultUserIdStrategy:
      value.defaultUserIdStrategy === 'session-key' || value.defaultUserIdStrategy === 'session-id'
        ? value.defaultUserIdStrategy
        : 'session-origin',
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

function asOptionalStringOrNumber(value: unknown): string | number | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
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

function normalizeSessionStoreKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeAgentId(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed.replace(/[^a-z0-9._-]+/g, '-') : 'main';
}

function normalizeIdentitySegment(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return undefined;
  }
  const normalized = String(value).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) {
    return undefined;
  }
  return encodeURIComponent(normalized);
}

function stripProviderPrefix(
  value: string | undefined,
  provider: string,
): string | undefined {
  if (!value) {
    return undefined;
  }
  const prefix = `${decodeURIComponent(provider)}:`;
  return value.toLowerCase().startsWith(prefix) ? value.slice(prefix.length) : value;
}

function extractOpenClawCommand(
  prompt: string,
): { command: string; args?: string } | null {
  const stripped = prompt
    .normalize('NFKC')
    .replace(/^\s*(?:\[[^\]\n]{1,160}\]\s*)+/, '')
    .trimStart();
  if (!stripped.startsWith('/')) {
    return null;
  }
  const firstLine = stripped.split('\n', 1)[0]?.trim();
  if (!firstLine) {
    return null;
  }
  const spaceIndex = firstLine.indexOf(' ');
  if (spaceIndex === -1) {
    return { command: firstLine };
  }
  const command = firstLine.slice(0, spaceIndex).trim();
  const args = firstLine.slice(spaceIndex + 1).trim();
  return command ? { command, args: args || undefined } : null;
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
