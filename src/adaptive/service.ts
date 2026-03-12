import { randomUUID } from 'node:crypto';
import type { DecisionRecord } from '../audit/types.js';
import type { ReviewInput } from '../audit/types.js';
import type { PermissionConfig } from '../types.js';
import type {
  AdaptiveObservation,
  AdaptiveOverlay,
  AdaptiveUserProfile,
  FamiliaritySnapshot,
  PolicySuggestion,
} from './types.js';
import type { AdaptiveStore } from './store.js';

export class AdaptivePolicyCopilot {
  constructor(private readonly store: AdaptiveStore) {}

  async ingestDecision(record: DecisionRecord): Promise<AdaptiveObservation> {
    const observation: AdaptiveObservation = {
      id: randomUUID(),
      createdAt: record.createdAt,
      userId: record.actor.userId,
      tenantId: record.actor.tenantId,
      sessionId: record.actor.sessionId,
      agentId: record.actor.agentId,
      allowed: record.result.allowed,
      code: record.result.code,
      permissionHints: record.policy.effectivePermissions.slice(0, 20),
      reviewStatus: record.review?.status,
    };
    await this.store.saveObservation(observation);
    await this.refreshUserState(record.actor.userId, record.actor.tenantId);
    return observation;
  }

  async ingestReview(input: ReviewInput, decision: DecisionRecord): Promise<void> {
    await this.store.saveObservation({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      userId: decision.actor.userId,
      tenantId: decision.actor.tenantId,
      sessionId: decision.actor.sessionId,
      agentId: decision.actor.agentId,
      allowed: decision.result.allowed,
      code: decision.result.code,
      permissionHints: decision.policy.effectivePermissions.slice(0, 20),
      reviewStatus: input.status,
    });
    await this.refreshUserState(decision.actor.userId, decision.actor.tenantId);
  }

  async getSuggestions(targetId?: string): Promise<PolicySuggestion[]> {
    const existing = await this.store.listSuggestions({ targetId, limit: 200 });
    if (existing.length > 0) return existing;

    const observations = await this.store.listObservations({ userId: targetId, limit: 200 });
    const generated = this.generateSuggestions(observations);
    for (const suggestion of generated) {
      await this.store.saveSuggestion(suggestion);
    }
    return generated;
  }

  async getFamiliarity(scopeId: string): Promise<FamiliaritySnapshot | null> {
    return this.store.getFamiliarity('user', scopeId);
  }

  async listActiveOverlays(targetId?: string): Promise<AdaptiveOverlay[]> {
    return this.store.listOverlays({ targetId });
  }

  async approveSuggestion(
    suggestionId: string,
    approverId: string,
  ): Promise<AdaptiveOverlay | null> {
    const suggestions = await this.store.listSuggestions({ limit: 500 });
    const suggestion = suggestions.find((item) => item.id === suggestionId);
    if (!suggestion) return null;
    const overlay: AdaptiveOverlay = {
      id: randomUUID(),
      scope: suggestion.targetType === 'tenant' ? 'tenant' : 'user',
      targetId: suggestion.targetId,
      changes: mapSuggestionToOverlay(suggestion),
      source: suggestion.riskTier === 'low' ? 'auto_low_risk' : 'approved',
      riskTier: suggestion.riskTier,
      createdAt: new Date().toISOString(),
      approvedBy: approverId,
    };
    await this.store.saveOverlay(overlay);
    return overlay;
  }

  applyOverlays(
    config: PermissionConfig,
    userId: string,
    tenantId?: string,
    overlays: AdaptiveOverlay[] = [],
  ): PermissionConfig {
    const activeOverlays = overlays.filter((overlay) =>
      overlay.scope === 'user'
        ? overlay.targetId === userId
        : overlay.scope === 'tenant'
          ? overlay.targetId === tenantId
          : false,
    );
    if (activeOverlays.length === 0) return config;

    const next = structuredClone(config);
    const user = next.users[userId] ?? {
      name: 'unknown',
      roles: [next.defaults.unknownUserRole],
    };
    const permissions = new Set(user.permissions ?? []);
    const denies = new Set(user.deny ?? []);

    for (const overlay of activeOverlays) {
      for (const permission of overlay.changes.addPermissions ?? []) {
        permissions.add(permission);
      }
      for (const permission of overlay.changes.addDenies ?? []) {
        denies.add(permission);
      }
      if (overlay.changes.adjustRateLimit !== undefined) {
        user.rateLimit = overlay.changes.adjustRateLimit;
      }
    }

    user.permissions = Array.from(permissions);
    user.deny = Array.from(denies);
    next.users[userId] = user;
    return next;
  }

  private async refreshUserState(userId: string, tenantId?: string): Promise<void> {
    const observations = await this.store.listObservations({ userId, tenantId, limit: 200 });
    const profile = buildProfile(userId, tenantId, observations);
    const familiarity = buildFamiliarity(userId, observations);
    await this.store.saveProfile(profile);
    await this.store.saveFamiliarity(familiarity);
    for (const suggestion of this.generateSuggestions(observations)) {
      await this.store.saveSuggestion(suggestion);
    }
  }

  private generateSuggestions(observations: AdaptiveObservation[]): PolicySuggestion[] {
    if (observations.length === 0) return [];
    const userId = observations[0].userId;
    const denied = observations.filter((item) => !item.allowed);
    const tooStrict = observations.filter((item) => item.reviewStatus === 'too_strict');
    const tooPermissive = observations.filter((item) => item.reviewStatus === 'too_permissive');
    const suggestions: PolicySuggestion[] = [];

    if (tooStrict.length >= 3) {
      suggestions.push({
        id: randomUUID(),
        targetType: 'user',
        targetId: userId,
        kind: 'grant_permission',
        title: `Consider a low-risk permission expansion for ${userId}`,
        rationale: 'Owner feedback repeatedly marked similar denials as too strict.',
        evidence: tooStrict.slice(0, 5).map((item) => `${item.createdAt}: ${item.code ?? 'n/a'}`),
        proposedChange: { addPermissions: inferLikelyGrant(tooStrict) },
        riskTier: 'medium',
        confidence: 0.72,
        createdAt: new Date().toISOString(),
      });
    }

    if (tooPermissive.length >= 2 || denied.length >= 5) {
      suggestions.push({
        id: randomUUID(),
        targetType: 'user',
        targetId: userId,
        kind: 'tighten_review',
        title: `Increase review intensity for ${userId}`,
        rationale: 'Observed repeated denials or owner feedback indicating insufficient restriction.',
        evidence: [...tooPermissive, ...denied].slice(0, 5).map((item) => `${item.createdAt}: ${item.code ?? 'n/a'}`),
        proposedChange: { reviewIntensity: 'high' },
        riskTier: 'low',
        confidence: 0.81,
        createdAt: new Date().toISOString(),
      });
    }

    return dedupeSuggestions(suggestions);
  }
}

function buildProfile(
  userId: string,
  tenantId: string | undefined,
  observations: AdaptiveObservation[],
): AdaptiveUserProfile {
  const denied = observations.filter((item) => !item.allowed).length;
  const total = observations.length;
  const tooPermissive = observations.filter((item) => item.reviewStatus === 'too_permissive').length;
  const tooStrict = observations.filter((item) => item.reviewStatus === 'too_strict').length;
  const inferredLabels = new Set<string>();

  if (denied >= 5) inferredLabels.add('risky_prober');
  if (tooStrict >= 3) inferredLabels.add('trusted_repeat_operator');
  if (denied === 0 && total >= 10) inferredLabels.add('stable_low_risk_user');

  let trustBand: AdaptiveUserProfile['trustBand'] = 'unknown';
  if (denied >= 5 || tooPermissive >= 2) trustBand = 'restricted';
  else if (tooStrict >= 3) trustBand = 'medium';
  else if (total >= 10 && denied <= 1) trustBand = 'high';
  else if (total >= 3) trustBand = 'low';

  return {
    userId,
    tenantId,
    inferredLabels: Array.from(inferredLabels),
    trustBand,
    confidence: total === 0 ? 0 : Math.min(0.95, 0.4 + total / 50),
    evidenceSummary: [
      `total observations: ${total}`,
      `denied: ${denied}`,
      `too_strict feedback: ${tooStrict}`,
      `too_permissive feedback: ${tooPermissive}`,
    ],
    lastUpdatedAt: new Date().toISOString(),
  };
}

function buildFamiliarity(
  userId: string,
  observations: AdaptiveObservation[],
): FamiliaritySnapshot {
  const total = observations.length;
  const correct = observations.filter((item) => item.reviewStatus === 'correct').length;
  const tooStrict = observations.filter((item) => item.reviewStatus === 'too_strict').length;
  const tooPermissive = observations.filter((item) => item.reviewStatus === 'too_permissive').length;
  const denied = observations.filter((item) => !item.allowed).length;
  const score = Math.max(
    0,
    Math.min(
      100,
      20 + correct * 6 + tooStrict * 4 - tooPermissive * 8 - Math.max(0, denied - 2) * 3,
    ),
  );
  const state = score >= 80
    ? 'aligned'
    : score >= 55
      ? 'stabilizing'
      : denied >= 5 || tooPermissive >= 2
        ? 'watchful'
        : 'learning';
  return {
    scopeType: 'user',
    scopeId: userId,
    score,
    state,
    updatedAt: new Date().toISOString(),
    signals: {
      total,
      correct,
      tooStrict,
      tooPermissive,
      denied,
    },
  };
}

function inferLikelyGrant(observations: AdaptiveObservation[]): string[] {
  const permissions = new Set<string>();
  for (const observation of observations) {
    for (const permission of observation.permissionHints) {
      if (permission.startsWith('info.public.') || permission.startsWith('info.own.')) {
        permissions.add(permission);
      }
    }
  }
  return Array.from(permissions).slice(0, 5);
}

function mapSuggestionToOverlay(suggestion: PolicySuggestion): AdaptiveOverlay['changes'] {
  switch (suggestion.kind) {
    case 'grant_permission':
      return {
        addPermissions: Array.isArray(suggestion.proposedChange.addPermissions)
          ? suggestion.proposedChange.addPermissions as string[]
          : [],
      };
    case 'tighten_review':
      return { reviewIntensity: 'high' };
    case 'adjust_rate_limit':
      return {
        adjustRateLimit: typeof suggestion.proposedChange.adjustRateLimit === 'number'
          ? suggestion.proposedChange.adjustRateLimit
          : null,
      };
    default:
      return {};
  }
}

function dedupeSuggestions(suggestions: PolicySuggestion[]): PolicySuggestion[] {
  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    const key = `${suggestion.targetId}:${suggestion.kind}:${JSON.stringify(suggestion.proposedChange)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
