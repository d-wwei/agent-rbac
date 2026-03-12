/**
 * Per-user memory manager — high-level API over MemoryStore.
 *
 * Provides structured access to: profile, preferences, memory, sessions, projects.
 * Enforces isolation: non-owner can only access their own memory.
 */

import type { MemoryStore, UserPermissions } from '../types.js';
import { hasPermission } from '../core/permission-resolver.js';

export class UserMemoryManager {
  constructor(private readonly store: MemoryStore) {}

  // ── Access control ─────────────────────────────────────────────

  /**
   * Backward-compatible read access check.
   */
  canAccess(requester: UserPermissions, targetUserId: string): boolean {
    return this.canRead(requester, targetUserId);
  }

  canRead(requester: UserPermissions, targetUserId: string): boolean {
    if (requester.userId === targetUserId) {
      return hasPermission(requester, 'info.own.memory.read');
    }
    return hasPermission(requester, 'info.others.memory.read');
  }

  canWrite(requester: UserPermissions, targetUserId: string): boolean {
    if (requester.userId === targetUserId) {
      return hasPermission(requester, 'info.own.memory.write');
    }
    return hasPermission(requester, 'info.others.memory.write');
  }

  // ── Profile ────────────────────────────────────────────────────

  async readProfile(
    requester: UserPermissions,
    userId: string,
  ): Promise<string | null> {
    if (!this.canRead(requester, userId)) return null;
    return this.store.read(userId, 'profile');
  }

  async writeProfile(
    requester: UserPermissions,
    userId: string,
    content: string,
  ): Promise<boolean> {
    if (!this.canWrite(requester, userId)) return false;
    await this.store.write(userId, 'profile', content);
    return true;
  }

  // ── Preferences ────────────────────────────────────────────────

  async readPreferences(
    requester: UserPermissions,
    userId: string,
  ): Promise<string | null> {
    if (!this.canRead(requester, userId)) return null;
    return this.store.read(userId, 'preferences');
  }

  async writePreferences(
    requester: UserPermissions,
    userId: string,
    content: string,
  ): Promise<boolean> {
    if (!this.canWrite(requester, userId)) return false;
    await this.store.write(userId, 'preferences', content);
    return true;
  }

  // ── Long-term memory ──────────────────────────────────────────

  async readMemory(
    requester: UserPermissions,
    userId: string,
  ): Promise<string | null> {
    if (!this.canRead(requester, userId)) return null;
    return this.store.read(userId, 'memory');
  }

  async writeMemory(
    requester: UserPermissions,
    userId: string,
    content: string,
  ): Promise<boolean> {
    if (!this.canWrite(requester, userId)) return false;
    await this.store.write(userId, 'memory', content);
    return true;
  }

  // ── Sessions ───────────────────────────────────────────────────

  async readSessionsIndex(
    requester: UserPermissions,
    userId: string,
  ): Promise<string | null> {
    if (!this.canRead(requester, userId)) return null;
    return this.store.read(userId, 'sessions-index');
  }

  async readSession(
    requester: UserPermissions,
    userId: string,
    sessionId: string,
  ): Promise<string | null> {
    if (!this.canRead(requester, userId)) return null;
    return this.store.read(userId, `sessions/${sessionId}`);
  }

  async writeSession(
    requester: UserPermissions,
    userId: string,
    sessionId: string,
    content: string,
  ): Promise<boolean> {
    if (!this.canWrite(requester, userId)) return false;
    await this.store.write(userId, `sessions/${sessionId}`, content);
    return true;
  }

  // ── Projects ───────────────────────────────────────────────────

  async readProject(
    requester: UserPermissions,
    userId: string,
    projectName: string,
  ): Promise<string | null> {
    if (!this.canRead(requester, userId)) return null;
    return this.store.read(userId, `projects/${projectName}`);
  }

  async writeProject(
    requester: UserPermissions,
    userId: string,
    projectName: string,
    content: string,
  ): Promise<boolean> {
    if (!this.canWrite(requester, userId)) return false;
    await this.store.write(userId, `projects/${projectName}`, content);
    return true;
  }

  // ── Generic key access ─────────────────────────────────────────

  async read(
    requester: UserPermissions,
    userId: string,
    key: string,
  ): Promise<string | null> {
    if (!this.canRead(requester, userId)) return null;
    return this.store.read(userId, key);
  }

  async write(
    requester: UserPermissions,
    userId: string,
    key: string,
    content: string,
  ): Promise<boolean> {
    if (!this.canWrite(requester, userId)) return false;
    await this.store.write(userId, key, content);
    return true;
  }

  async deleteKey(
    requester: UserPermissions,
    userId: string,
    key: string,
  ): Promise<boolean> {
    if (!this.canWrite(requester, userId)) return false;
    return this.store.delete(userId, key);
  }

  async listKeys(
    requester: UserPermissions,
    userId: string,
  ): Promise<string[]> {
    if (!this.canRead(requester, userId)) return [];
    return this.store.list(userId);
  }
}
