/**
 * Runtime permission management — grant, revoke, assign/remove roles.
 *
 * Modifies in-memory config and optionally persists via ConfigLoader.save().
 */

import type {
  ConfigLoader,
  PermissionConfig,
  PermissionManagerOps,
} from '../types.js';

export class PermissionManager implements PermissionManagerOps {
  private config: PermissionConfig;

  constructor(private readonly configLoader: ConfigLoader) {
    this.config = configLoader.load();
  }

  /**
   * Reload config from source.
   */
  reload(): void {
    this.config = this.configLoader.load();
  }

  /**
   * Get current config snapshot.
   */
  getConfig(): PermissionConfig {
    return this.config;
  }

  /**
   * Grant additional permissions to a user.
   * Creates the user entry if it doesn't exist.
   */
  grant(userId: string, permissions: string[]): void {
    this.ensureUser(userId);
    const user = this.config.users[userId];
    const existing = new Set(user.permissions ?? []);
    for (const p of permissions) existing.add(p);
    user.permissions = Array.from(existing);
    this.persist();
  }

  /**
   * Revoke permissions from a user by adding them to the deny list.
   */
  revoke(userId: string, permissions: string[]): void {
    this.ensureUser(userId);
    const user = this.config.users[userId];
    const existing = new Set(user.deny ?? []);
    for (const p of permissions) existing.add(p);
    user.deny = Array.from(existing);

    // Also remove from direct permissions if present
    if (user.permissions) {
      user.permissions = user.permissions.filter(
        (p) => !permissions.includes(p),
      );
    }
    this.persist();
  }

  /**
   * Assign a role to a user.
   */
  assignRole(userId: string, role: string): void {
    if (!this.config.roles[role]) {
      throw new Error(`Role "${role}" does not exist in config.`);
    }
    this.ensureUser(userId);
    const user = this.config.users[userId];
    if (!user.roles.includes(role)) {
      user.roles.push(role);
    }
    this.persist();
  }

  /**
   * Remove a role from a user.
   */
  removeRole(userId: string, role: string): void {
    const user = this.config.users[userId];
    if (!user) return;
    user.roles = user.roles.filter((r) => r !== role);
    this.persist();
  }

  /**
   * Set rate limit for a user. Pass null for unlimited.
   */
  setRateLimit(userId: string, limit: number | null): void {
    this.ensureUser(userId);
    this.config.users[userId].rateLimit = limit;
    this.persist();
  }

  /**
   * Create a new role.
   */
  createRole(
    roleName: string,
    definition: {
      name: string;
      permissions: string[];
      deny?: string[];
      rateLimit?: number | null;
      maxMode?: string;
    },
  ): void {
    this.config.roles[roleName] = definition;
    this.persist();
  }

  /**
   * Delete a role. Does not remove it from existing users.
   */
  deleteRole(roleName: string): void {
    delete this.config.roles[roleName];
    this.persist();
  }

  /**
   * Set the default unknown user role.
   */
  setDefaultRole(roleName: string): void {
    if (!this.config.roles[roleName]) {
      throw new Error(`Role "${roleName}" does not exist in config.`);
    }
    this.config.defaults.unknownUserRole = roleName;
    this.persist();
  }

  private ensureUser(userId: string): void {
    if (!this.config.users[userId]) {
      this.config.users[userId] = {
        name: 'unknown',
        roles: [this.config.defaults.unknownUserRole],
      };
    }
  }

  private persist(): void {
    if (this.configLoader.save) {
      this.configLoader.save(this.config);
    }
  }
}
