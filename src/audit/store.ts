import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  DecisionRecord,
  DiffRecord,
  ReviewInput,
  TimelineFilter,
} from './types.js';

export interface AuditStore {
  saveDecision(decision: DecisionRecord): Promise<void>;
  saveDiff(diff: DiffRecord): Promise<void>;
  getDecision(id: string): Promise<DecisionRecord | null>;
  listDecisions(filter?: TimelineFilter): Promise<DecisionRecord[]>;
  listDiffs(decisionId: string): Promise<DiffRecord[]>;
  updateReview(input: ReviewInput): Promise<DecisionRecord | null>;
}

export class FileSystemAuditStore implements AuditStore {
  constructor(private readonly rootDir: string) {}

  async saveDecision(decision: DecisionRecord): Promise<void> {
    const filePath = this.getDecisionPath(decision.id, decision.createdAt);
    this.ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(decision, null, 2) + '\n', 'utf-8');
  }

  async saveDiff(diff: DiffRecord): Promise<void> {
    const filePath = this.getDiffPath(diff.id);
    this.ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(diff, null, 2) + '\n', 'utf-8');
  }

  async getDecision(id: string): Promise<DecisionRecord | null> {
    for (const filePath of this.walkFiles(path.join(this.rootDir, 'decisions'))) {
      if (!filePath.endsWith(`${id}.json`)) continue;
      return this.readJson<DecisionRecord>(filePath);
    }
    return null;
  }

  async listDecisions(filter: TimelineFilter = {}): Promise<DecisionRecord[]> {
    const decisions = this.walkFiles(path.join(this.rootDir, 'decisions'))
      .map((filePath) => this.readJson<DecisionRecord>(filePath))
      .filter((item): item is DecisionRecord => item !== null)
      .filter((record) => this.matchesFilter(record, filter))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return decisions.slice(0, filter.limit ?? 200);
  }

  async listDiffs(decisionId: string): Promise<DiffRecord[]> {
    return this.walkFiles(path.join(this.rootDir, 'diffs'))
      .map((filePath) => this.readJson<DiffRecord>(filePath))
      .filter((item): item is DiffRecord => item !== null)
      .filter((diff) => diff.decisionId === decisionId);
  }

  async updateReview(input: ReviewInput): Promise<DecisionRecord | null> {
    const decision = await this.getDecision(input.decisionId);
    if (!decision) return null;
    decision.review = {
      status: input.status,
      reviewerId: input.reviewerId,
      reviewedAt: new Date().toISOString(),
      note: input.note,
    };
    await this.saveDecision(decision);
    return decision;
  }

  private getDecisionPath(id: string, createdAt: string): string {
    const stamp = createdAt.slice(0, 10);
    return path.join(this.rootDir, 'decisions', stamp, `${id}.json`);
  }

  private getDiffPath(id: string): string {
    return path.join(this.rootDir, 'diffs', `${id}.json`);
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private walkFiles(root: string): string[] {
    if (!fs.existsSync(root)) return [];
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const results: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.walkFiles(fullPath));
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.json')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  private readJson<T>(filePath: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    } catch {
      return null;
    }
  }

  private matchesFilter(record: DecisionRecord, filter: TimelineFilter): boolean {
    if (filter.tenantId && record.actor.tenantId !== filter.tenantId) return false;
    if (filter.userId && record.actor.userId !== filter.userId) return false;
    if (filter.sessionId && record.actor.sessionId !== filter.sessionId) return false;
    if (filter.agentId && record.actor.agentId !== filter.agentId) return false;
    if (filter.kind && record.kind !== filter.kind) return false;
    if (filter.startDate && record.createdAt < filter.startDate) return false;
    if (filter.endDate && record.createdAt > filter.endDate) return false;
    return true;
  }
}
