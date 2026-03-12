import { InMemoryConfigLoader } from '../config/loader.js';
import { EnforcementPipeline, type PipelineOptions } from '../enforcement/pipeline.js';
import type { ConfigLoader, PermissionConfig, RbacAdapter } from '../types.js';
import type { HostAdapter, HostDecision, HostRequest } from '../host/types.js';
import type { AuditService } from '../audit/service.js';
import type { AdaptivePolicyCopilot } from '../adaptive/service.js';

export interface SecurityRuntimeOptions<TRawRequest = unknown, TRawOutput = unknown> {
  configLoader: ConfigLoader;
  hostAdapter: HostAdapter<TRawRequest, unknown, TRawOutput>;
  pipeline?: Omit<PipelineOptions, 'configLoader' | 'adapter'>;
  auditService?: AuditService;
  adaptiveCopilot?: AdaptivePolicyCopilot;
  adapterPermissionMapper?: RbacAdapter;
}

export class AgentSecurityRuntime<TRawRequest = unknown, TRawOutput = unknown> {
  constructor(
    private readonly opts: SecurityRuntimeOptions<TRawRequest, TRawOutput>,
  ) {}

  async evaluate(rawRequest: TRawRequest): Promise<{
    request: HostRequest;
    decision: HostDecision;
  }> {
    const request = await this.opts.hostAdapter.normalizeRequest(rawRequest);
    const config = await this.loadEffectiveConfig(request);
    const pipeline = new EnforcementPipeline({
      configLoader: new InMemoryConfigLoader(config),
      adapter: this.opts.adapterPermissionMapper,
      ...this.opts.pipeline,
    });
    const result = await pipeline.enforceAsync({
      userId: request.identity.userId,
      message: request.message.text,
      command: request.message.command,
      commandArgs: request.message.commandArgs,
      currentMode: request.message.currentMode,
      locale: request.identity.locale,
      toolCall: request.toolIntent
        ? {
            toolName: request.toolIntent.toolName,
            filePaths: request.toolIntent.resources
              ?.map((resource) => resource.path)
              .filter((value): value is string => Boolean(value)),
            args: request.toolIntent.args,
          }
        : undefined,
    });

    const decision: HostDecision = {
      allowed: result.allowed,
      enforcedMode: result.enforcedMode,
      denialCode: result.code,
      denialReason: result.reason,
      injectedPrompt:
        typeof result.context?.injectedPrompt === 'string'
          ? result.context.injectedPrompt
          : undefined,
      loadedMemorySummary:
        result.context?.loadedMemory && typeof result.context.loadedMemory === 'object'
          ? result.context.loadedMemory as Record<string, unknown>
          : undefined,
      allowedToolResources: result.allowed ? request.toolIntent?.resources : [],
      rewrittenOutputPolicy: {
        redactSensitive: true,
        rewriteBoundaryExplanations: true,
      },
    };

    await this.opts.hostAdapter.applyDecisionToHostContext(request, decision);

    if (this.opts.auditService) {
      const decisionRecord = await this.opts.auditService.recordEnforcement(request, result, {
        dynamicOverlays: (await this.opts.adaptiveCopilot?.listActiveOverlays(request.identity.userId))?.map((overlay) => overlay.id),
        trustState: (await this.opts.adaptiveCopilot?.getFamiliarity(request.identity.userId))?.state,
        source: this.opts.adaptiveCopilot ? 'mixed' : 'static_policy',
      });
      decision.traceId = decisionRecord.id;
      await this.opts.adaptiveCopilot?.ingestDecision(decisionRecord);
    }

    return { request, decision };
  }

  async finalizeOutput(
    rawOutput: TRawOutput,
    decision: HostDecision,
  ): Promise<TRawOutput> {
    if (this.opts.hostAdapter.finalizeOutput) {
      return this.opts.hostAdapter.finalizeOutput(rawOutput, decision);
    }
    return rawOutput;
  }

  async reviewDecision(input: {
    decisionId: string;
    reviewerId: string;
    status: 'correct' | 'too_strict' | 'too_permissive' | 'policy_bug' | 'adapter_bug';
    note?: string;
  }): Promise<void> {
    if (!this.opts.auditService) {
      throw new Error('Audit service is required for review operations.');
    }
    const reviewed = await this.opts.auditService.review(input);
    if (reviewed && this.opts.adaptiveCopilot) {
      await this.opts.adaptiveCopilot.ingestReview(input, reviewed);
    }
  }

  private async loadEffectiveConfig(request: HostRequest): Promise<PermissionConfig> {
    const baseConfig = this.opts.configLoader.load();
    const overlays = await this.opts.adaptiveCopilot?.listActiveOverlays(request.identity.userId);
    if (!this.opts.adaptiveCopilot || !overlays) return baseConfig;
    return this.opts.adaptiveCopilot.applyOverlays(
      baseConfig,
      request.identity.userId,
      request.identity.tenantId,
      overlays,
    );
  }
}
