import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  AdaptiveObservation,
  AdaptiveOverlay,
  AdaptiveUserProfile,
  FamiliaritySnapshot,
  PolicySuggestion,
} from './types.js';

export interface AdaptiveStore {
  saveObservation(observation: AdaptiveObservation): Promise<void>;
  listObservations(filter?: { userId?: string; tenantId?: string; limit?: number }): Promise<AdaptiveObservation[]>;
  saveProfile(profile: AdaptiveUserProfile): Promise<void>;
  getProfile(userId: string, tenantId?: string): Promise<AdaptiveUserProfile | null>;
  saveOverlay(overlay: AdaptiveOverlay): Promise<void>;
  listOverlays(filter?: { targetId?: string; includeExpired?: boolean }): Promise<AdaptiveOverlay[]>;
  saveSuggestion(suggestion: PolicySuggestion): Promise<void>;
  listSuggestions(filter?: { targetId?: string; limit?: number }): Promise<PolicySuggestion[]>;
  saveFamiliarity(snapshot: FamiliaritySnapshot): Promise<void>;
  getFamiliarity(scopeType: FamiliaritySnapshot['scopeType'], scopeId: string): Promise<FamiliaritySnapshot | null>;
}

export class FileSystemAdaptiveStore implements AdaptiveStore {
  constructor(private readonly rootDir: string) {}

  async saveObservation(observation: AdaptiveObservation): Promise<void> {
    this.writeJson(path.join(this.rootDir, 'observations', `${observation.id}.json`), observation);
  }

  async listObservations(filter: { userId?: string; tenantId?: string; limit?: number } = {}): Promise<AdaptiveObservation[]> {
    return this.walk(path.join(this.rootDir, 'observations'))
      .map((filePath) => this.readJson<AdaptiveObservation>(filePath))
      .filter((value): value is AdaptiveObservation => value !== null)
      .filter((observation) => {
        if (filter.userId && observation.userId !== filter.userId) return false;
        if (filter.tenantId && observation.tenantId !== filter.tenantId) return false;
        return true;
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, filter.limit ?? 500);
  }

  async saveProfile(profile: AdaptiveUserProfile): Promise<void> {
    this.writeJson(path.join(this.rootDir, 'profiles', this.profileKey(profile.userId, profile.tenantId)), profile);
  }

  async getProfile(userId: string, tenantId?: string): Promise<AdaptiveUserProfile | null> {
    return this.readJson(path.join(this.rootDir, 'profiles', this.profileKey(userId, tenantId)));
  }

  async saveOverlay(overlay: AdaptiveOverlay): Promise<void> {
    this.writeJson(path.join(this.rootDir, 'overlays', `${overlay.id}.json`), overlay);
  }

  async listOverlays(filter: { targetId?: string; includeExpired?: boolean } = {}): Promise<AdaptiveOverlay[]> {
    const now = new Date().toISOString();
    return this.walk(path.join(this.rootDir, 'overlays'))
      .map((filePath) => this.readJson<AdaptiveOverlay>(filePath))
      .filter((value): value is AdaptiveOverlay => value !== null)
      .filter((overlay) => {
        if (filter.targetId && overlay.targetId !== filter.targetId) return false;
        if (!filter.includeExpired && overlay.expiresAt && overlay.expiresAt < now) return false;
        return true;
      });
  }

  async saveSuggestion(suggestion: PolicySuggestion): Promise<void> {
    this.writeJson(path.join(this.rootDir, 'suggestions', `${suggestion.id}.json`), suggestion);
  }

  async listSuggestions(filter: { targetId?: string; limit?: number } = {}): Promise<PolicySuggestion[]> {
    return this.walk(path.join(this.rootDir, 'suggestions'))
      .map((filePath) => this.readJson<PolicySuggestion>(filePath))
      .filter((value): value is PolicySuggestion => value !== null)
      .filter((suggestion) => !filter.targetId || suggestion.targetId === filter.targetId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, filter.limit ?? 100);
  }

  async saveFamiliarity(snapshot: FamiliaritySnapshot): Promise<void> {
    this.writeJson(path.join(this.rootDir, 'familiarity', `${snapshot.scopeType}-${snapshot.scopeId}.json`), snapshot);
  }

  async getFamiliarity(scopeType: FamiliaritySnapshot['scopeType'], scopeId: string): Promise<FamiliaritySnapshot | null> {
    return this.readJson(path.join(this.rootDir, 'familiarity', `${scopeType}-${scopeId}.json`));
  }

  private writeJson(filePath: string, value: unknown): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf-8');
  }

  private readJson<T>(filePath: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    } catch {
      return null;
    }
  }

  private walk(root: string): string[] {
    if (!fs.existsSync(root)) return [];
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const results: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.walk(fullPath));
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.json')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  private profileKey(userId: string, tenantId?: string): string {
    return tenantId ? `${tenantId}--${userId}.json` : `${userId}.json`;
  }
}
