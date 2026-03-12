/**
 * Enforcement Pipeline — orchestrates Layer 1-6 in sequence.
 */

import type {
  EnforcementContext,
  EnforcementResult,
  EnforcementLayer,
  AsyncEnforcementLayer,
  ConfigLoader,
  ModeHierarchy,
  RbacAdapter,
  EnforcementTrace,
} from '../types.js';
import { resolveUser } from '../core/permission-resolver.js';
import { RateLimiter } from '../core/rate-limiter.js';
import { CommandMapper } from '../core/command-mapper.js';
import { createGatewayLayer } from './gateway.js';
import { createCommandFilterLayer } from './command-filter.js';
import { createCapabilityModeLayer } from './capability-mode.js';
import {
  createAsyncContextLoaderLayer,
  createContextLoaderLayer,
  type ContextLoaderOptions,
} from './context-loader.js';
import { createPromptBuilderLayer, type PromptBuilderOptions } from './prompt-builder.js';
import { ToolInterceptor } from './tool-interceptor.js';
import { validateConfigSemantics } from '../config/schema.js';

export interface PipelineOptions {
  configLoader: ConfigLoader;
  hierarchy?: ModeHierarchy;
  adapter?: RbacAdapter;
  rateLimiter?: RateLimiter;
  commandMapper?: CommandMapper;
  contextLoaderOpts?: ContextLoaderOptions;
  promptBuilderOpts?: PromptBuilderOptions;
  locale?: string;
  /** Additional custom layers to run after the built-in ones */
  customLayers?: EnforcementLayer[];
  /** Additional async custom layers to run in enforceAsync() */
  asyncCustomLayers?: AsyncEnforcementLayer[];
}

export class EnforcementPipeline {
  private readonly configLoader: ConfigLoader;
  private readonly hierarchy?: ModeHierarchy;
  private readonly adapter?: RbacAdapter;
  private readonly rateLimiter: RateLimiter;
  private readonly commandMapper: CommandMapper;
  private readonly layers: EnforcementLayer[];
  private readonly asyncLayers: AsyncEnforcementLayer[];
  private readonly layerNames: string[];
  private readonly locale?: string;

  constructor(opts: PipelineOptions) {
    this.configLoader = opts.configLoader;
    this.hierarchy = opts.hierarchy;
    this.adapter = opts.adapter;
    this.rateLimiter = opts.rateLimiter ?? new RateLimiter();
    this.commandMapper = opts.commandMapper ?? new CommandMapper();
    this.locale = opts.locale;

    this.layers = [
      createGatewayLayer(this.rateLimiter),                      // Layer 1
      createCommandFilterLayer(this.commandMapper),               // Layer 2
      createContextLoaderLayer(opts.contextLoaderOpts),            // Layer 3
      createCapabilityModeLayer(this.hierarchy),                   // Layer 4
      // Layer 5 (tool interception) is handled inline via ToolInterceptor
      createPromptBuilderLayer(opts.promptBuilderOpts),            // Layer 6
      ...(opts.customLayers ?? []),
    ];

    this.asyncLayers = [
      createGatewayLayer(this.rateLimiter),
      createCommandFilterLayer(this.commandMapper),
      createAsyncContextLoaderLayer(opts.contextLoaderOpts),
      createCapabilityModeLayer(this.hierarchy),
      createPromptBuilderLayer(opts.promptBuilderOpts),
      ...(opts.asyncCustomLayers ?? []),
    ];
    this.layerNames = [
      'gateway',
      'command-filter',
      'context-loader',
      'capability-mode',
      'prompt-builder',
      ...Array.from({ length: opts.customLayers?.length ?? 0 }, (_, i) => `custom-${i + 1}`),
    ];
  }

  /**
   * Run the full enforcement pipeline for a message.
   * Config is re-read on every call (hot-reload).
   */
  enforce(input: {
    userId: string;
    message: string;
    command?: string;
    commandArgs?: string;
    currentMode?: string;
    toolCall?: { toolName: string; filePaths?: string[]; args?: Record<string, unknown> };
    locale?: string;
  }): EnforcementResult {
    const config = validateConfigSemantics(
      this.configLoader.load(),
      { hierarchy: this.hierarchy },
    );
    const user = resolveUser(config, input.userId, this.hierarchy);

    const ctx: EnforcementContext = {
      userId: input.userId,
      user,
      config,
      input: input.message,
      command: input.command,
      commandArgs: input.commandArgs,
      currentMode: input.currentMode,
      toolCall: input.toolCall,
      locale: input.locale ?? this.locale,
    };

    return this.runSync(ctx, config);
  }

  async enforceAsync(input: {
    userId: string;
    message: string;
    command?: string;
    commandArgs?: string;
    currentMode?: string;
    toolCall?: { toolName: string; filePaths?: string[]; args?: Record<string, unknown> };
    locale?: string;
  }): Promise<EnforcementResult> {
    const config = validateConfigSemantics(
      this.configLoader.load(),
      { hierarchy: this.hierarchy },
    );
    const user = resolveUser(config, input.userId, this.hierarchy);

    const ctx: EnforcementContext = {
      userId: input.userId,
      user,
      config,
      input: input.message,
      command: input.command,
      commandArgs: input.commandArgs,
      currentMode: input.currentMode,
      toolCall: input.toolCall,
      locale: input.locale ?? this.locale,
    };

    return this.runAsync(ctx, config);
  }

  /**
   * Quick permission check without running the full pipeline.
   */
  resolveUser(userId: string) {
    const config = validateConfigSemantics(
      this.configLoader.load(),
      { hierarchy: this.hierarchy },
    );
    return resolveUser(config, userId, this.hierarchy);
  }

  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  getCommandMapper(): CommandMapper {
    return this.commandMapper;
  }

  private runSync(ctx: EnforcementContext, config: ReturnType<ConfigLoader['load']>): EnforcementResult {
    const mergedContext: Record<string, unknown> = {};
    let enforcedMode: string | undefined;
    const trace = this.createTrace(ctx);

    for (const [index, layer] of this.layers.entries()) {
      trace.evaluatedLayers.push(this.layerNames[index] ?? `layer-${index + 1}`);
      const result = layer(ctx);
      if (!result) continue;
      this.mergeTrace(trace, result.trace);
      if (!result.allowed) {
        return this.finalizeResult(result, trace);
      }
      if (result.context) Object.assign(mergedContext, result.context);
      if (result.enforcedMode) {
        enforcedMode = result.enforcedMode;
        trace.enforcedMode = result.enforcedMode;
      }
    }

    if (ctx.toolCall) {
      const interceptor = new ToolInterceptor(config, this.adapter);
      const toolResult = interceptor.check(ctx.user, ctx.toolCall, ctx.locale);
      trace.normalizedToolPaths = toolResult.normalizedPaths;
      trace.matchedToolPermissions = toolResult.matchedPermissions;
      if (!toolResult.allowed) {
        trace.deniedBy = 'tool-interceptor';
        trace.denialCode = toolResult.code;
        return {
          allowed: false,
          deniedBy: 'tool-interceptor',
          code: toolResult.code,
          reason: toolResult.reason,
          trace,
        };
      }
    }

    return {
      allowed: true,
      context: mergedContext,
      enforcedMode,
      trace,
    };
  }

  private async runAsync(
    ctx: EnforcementContext,
    config: ReturnType<ConfigLoader['load']>,
  ): Promise<EnforcementResult> {
    const mergedContext: Record<string, unknown> = {};
    let enforcedMode: string | undefined;
    const trace = this.createTrace(ctx);

    for (const [index, layer] of this.asyncLayers.entries()) {
      trace.evaluatedLayers.push(this.layerNames[index] ?? `layer-${index + 1}`);
      const result = await layer(ctx);
      if (!result) continue;
      this.mergeTrace(trace, result.trace);
      if (!result.allowed) {
        return this.finalizeResult(result, trace);
      }
      if (result.context) Object.assign(mergedContext, result.context);
      if (result.enforcedMode) {
        enforcedMode = result.enforcedMode;
        trace.enforcedMode = result.enforcedMode;
      }
    }

    if (ctx.toolCall) {
      const interceptor = new ToolInterceptor(config, this.adapter);
      const toolResult = interceptor.check(ctx.user, ctx.toolCall, ctx.locale);
      trace.normalizedToolPaths = toolResult.normalizedPaths;
      trace.matchedToolPermissions = toolResult.matchedPermissions;
      if (!toolResult.allowed) {
        trace.deniedBy = 'tool-interceptor';
        trace.denialCode = toolResult.code;
        return {
          allowed: false,
          deniedBy: 'tool-interceptor',
          code: toolResult.code,
          reason: toolResult.reason,
          trace,
        };
      }
    }

    return {
      allowed: true,
      context: mergedContext,
      enforcedMode,
      trace,
    };
  }

  private createTrace(ctx: EnforcementContext): EnforcementTrace {
    return {
      evaluatedLayers: [],
      effectiveRole: ctx.user.topRole,
      effectivePermissions: Array.from(ctx.user.permissions).sort(),
    };
  }

  private mergeTrace(target: EnforcementTrace, trace?: EnforcementTrace): void {
    if (!trace) return;
    target.evaluatedLayers.push(...trace.evaluatedLayers);
    if (trace.commandPermission !== undefined) {
      target.commandPermission = trace.commandPermission;
    }
    if (trace.matchedToolPermissions) {
      target.matchedToolPermissions = [
        ...(target.matchedToolPermissions ?? []),
        ...trace.matchedToolPermissions,
      ];
    }
    if (trace.normalizedToolPaths) {
      target.normalizedToolPaths = [
        ...(target.normalizedToolPaths ?? []),
        ...trace.normalizedToolPaths,
      ];
    }
    target.deniedBy = trace.deniedBy ?? target.deniedBy;
    target.denialCode = trace.denialCode ?? target.denialCode;
    target.enforcedMode = trace.enforcedMode ?? target.enforcedMode;
  }

  private finalizeResult(result: EnforcementResult, trace: EnforcementTrace): EnforcementResult {
    trace.deniedBy = result.deniedBy ?? trace.deniedBy;
    trace.denialCode = result.code ?? trace.denialCode;
    trace.enforcedMode = result.enforcedMode ?? trace.enforcedMode;
    return {
      ...result,
      trace,
    };
  }
}
