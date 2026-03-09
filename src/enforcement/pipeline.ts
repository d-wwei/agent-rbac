/**
 * Enforcement Pipeline — orchestrates Layer 1-6 in sequence.
 */

import type {
  EnforcementContext,
  EnforcementResult,
  EnforcementLayer,
  ConfigLoader,
  ModeHierarchy,
  RbacAdapter,
} from '../types.js';
import { resolveUser } from '../core/permission-resolver.js';
import { RateLimiter } from '../core/rate-limiter.js';
import { CommandMapper } from '../core/command-mapper.js';
import { createGatewayLayer } from './gateway.js';
import { createCommandFilterLayer } from './command-filter.js';
import { createCapabilityModeLayer } from './capability-mode.js';
import { createContextLoaderLayer, type ContextLoaderOptions } from './context-loader.js';
import { createPromptBuilderLayer, type PromptBuilderOptions } from './prompt-builder.js';
import { ToolInterceptor } from './tool-interceptor.js';

export interface PipelineOptions {
  configLoader: ConfigLoader;
  hierarchy?: ModeHierarchy;
  adapter?: RbacAdapter;
  rateLimiter?: RateLimiter;
  commandMapper?: CommandMapper;
  contextLoaderOpts?: ContextLoaderOptions;
  promptBuilderOpts?: PromptBuilderOptions;
  /** Additional custom layers to run after the built-in ones */
  customLayers?: EnforcementLayer[];
}

export class EnforcementPipeline {
  private readonly configLoader: ConfigLoader;
  private readonly hierarchy?: ModeHierarchy;
  private readonly adapter?: RbacAdapter;
  private readonly rateLimiter: RateLimiter;
  private readonly commandMapper: CommandMapper;
  private readonly layers: EnforcementLayer[];

  constructor(opts: PipelineOptions) {
    this.configLoader = opts.configLoader;
    this.hierarchy = opts.hierarchy;
    this.adapter = opts.adapter;
    this.rateLimiter = opts.rateLimiter ?? new RateLimiter();
    this.commandMapper = opts.commandMapper ?? new CommandMapper();

    this.layers = [
      createGatewayLayer(this.rateLimiter),                      // Layer 1
      createCommandFilterLayer(this.commandMapper),               // Layer 2
      createContextLoaderLayer(opts.contextLoaderOpts),            // Layer 3
      createCapabilityModeLayer(this.hierarchy),                   // Layer 4
      // Layer 5 (tool interception) is handled inline via ToolInterceptor
      createPromptBuilderLayer(opts.promptBuilderOpts),            // Layer 6
      ...(opts.customLayers ?? []),
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
  }): EnforcementResult {
    const config = this.configLoader.load();
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
    };

    // Merged context from all layers
    const mergedContext: Record<string, unknown> = {};
    let enforcedMode: string | undefined;

    // Run through layers
    for (const layer of this.layers) {
      const result = layer(ctx);
      if (result) {
        if (!result.allowed) {
          return result; // Short-circuit on denial
        }
        if (result.context) {
          Object.assign(mergedContext, result.context);
        }
        if (result.enforcedMode) {
          enforcedMode = result.enforcedMode;
        }
      }
    }

    // Tool interception (Layer 5) — only if this is a tool call
    if (input.toolCall) {
      const interceptor = new ToolInterceptor(config, this.adapter);
      const toolResult = interceptor.check(user, input.toolCall);
      if (!toolResult.allowed) {
        return {
          allowed: false,
          deniedBy: 'tool-interceptor',
          reason: toolResult.reason,
        };
      }
    }

    return {
      allowed: true,
      context: mergedContext,
      enforcedMode,
    };
  }

  /**
   * Quick permission check without running the full pipeline.
   */
  resolveUser(userId: string) {
    const config = this.configLoader.load();
    return resolveUser(config, userId, this.hierarchy);
  }

  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  getCommandMapper(): CommandMapper {
    return this.commandMapper;
  }
}
