export interface AdaptiveObservation {
  id: string;
  createdAt: string;
  userId: string;
  tenantId?: string;
  sessionId: string;
  agentId: string;
  allowed: boolean;
  code?: string;
  permissionHints: string[];
  reviewStatus?: 'unreviewed' | 'correct' | 'too_strict' | 'too_permissive' | 'policy_bug' | 'adapter_bug';
}

export interface AdaptiveUserProfile {
  userId: string;
  tenantId?: string;
  inferredLabels: string[];
  trustBand: 'unknown' | 'low' | 'medium' | 'high' | 'restricted';
  confidence: number;
  evidenceSummary: string[];
  lastUpdatedAt: string;
}

export interface AdaptiveOverlay {
  id: string;
  scope: 'user' | 'group' | 'tenant';
  targetId: string;
  changes: {
    addPermissions?: string[];
    addDenies?: string[];
    adjustRateLimit?: number | null;
    preferredMode?: string;
    reviewIntensity?: 'low' | 'normal' | 'high';
  };
  source: 'suggested' | 'approved' | 'auto_low_risk';
  riskTier: 'low' | 'medium' | 'high';
  expiresAt?: string;
  createdAt: string;
  approvedBy?: string;
}

export interface PolicySuggestion {
  id: string;
  targetType: 'user' | 'role' | 'group' | 'tenant';
  targetId: string;
  kind:
    | 'grant_permission'
    | 'add_deny'
    | 'create_role'
    | 'reclassify_user'
    | 'tighten_review'
    | 'loosen_review'
    | 'adjust_rate_limit';
  title: string;
  rationale: string;
  evidence: string[];
  proposedChange: Record<string, unknown>;
  riskTier: 'low' | 'medium' | 'high';
  confidence: number;
  createdAt: string;
}

export interface FamiliaritySnapshot {
  scopeType: 'user' | 'group' | 'tenant';
  scopeId: string;
  score: number;
  state: 'learning' | 'stabilizing' | 'aligned' | 'watchful';
  updatedAt: string;
  signals: Record<string, number>;
}
