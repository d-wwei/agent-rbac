/**
 * Runtime configuration validation.
 */

import type { PermissionConfig } from '../types.js';

export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
  ) {
    super(`Config validation error [${field}]: ${message}`);
    this.name = 'ConfigValidationError';
  }
}

export function validateConfig(config: unknown): PermissionConfig {
  if (!config || typeof config !== 'object') {
    throw new ConfigValidationError('Config must be a non-null object', 'root');
  }

  const c = config as Record<string, unknown>;

  // owner
  if (typeof c.owner !== 'string') {
    throw new ConfigValidationError('owner must be a string', 'owner');
  }

  // roles
  if (!c.roles || typeof c.roles !== 'object') {
    throw new ConfigValidationError('roles must be an object', 'roles');
  }
  for (const [roleName, role] of Object.entries(
    c.roles as Record<string, unknown>,
  )) {
    validateRole(roleName, role);
  }

  // users
  if (!c.users || typeof c.users !== 'object') {
    throw new ConfigValidationError('users must be an object', 'users');
  }
  for (const [userId, user] of Object.entries(
    c.users as Record<string, unknown>,
  )) {
    validateUser(userId, user);
  }

  // defaults
  if (!c.defaults || typeof c.defaults !== 'object') {
    throw new ConfigValidationError('defaults must be an object', 'defaults');
  }
  const defaults = c.defaults as Record<string, unknown>;
  if (typeof defaults.unknownUserRole !== 'string') {
    throw new ConfigValidationError(
      'unknownUserRole must be a string',
      'defaults.unknownUserRole',
    );
  }

  // protectedPaths (optional)
  if (c.protectedPaths !== undefined) {
    if (typeof c.protectedPaths !== 'object' || c.protectedPaths === null) {
      throw new ConfigValidationError(
        'protectedPaths must be an object',
        'protectedPaths',
      );
    }
    for (const [perm, patterns] of Object.entries(
      c.protectedPaths as Record<string, unknown>,
    )) {
      if (!Array.isArray(patterns)) {
        throw new ConfigValidationError(
          `protectedPaths["${perm}"] must be an array of glob strings`,
          `protectedPaths.${perm}`,
        );
      }
      for (const p of patterns) {
        if (typeof p !== 'string') {
          throw new ConfigValidationError(
            `protectedPaths["${perm}"] entries must be strings`,
            `protectedPaths.${perm}`,
          );
        }
      }
    }
  }

  return config as PermissionConfig;
}

function validateRole(name: string, role: unknown): void {
  if (!role || typeof role !== 'object') {
    throw new ConfigValidationError(
      `role "${name}" must be an object`,
      `roles.${name}`,
    );
  }
  const r = role as Record<string, unknown>;
  if (typeof r.name !== 'string') {
    throw new ConfigValidationError(
      'name must be a string',
      `roles.${name}.name`,
    );
  }
  if (!Array.isArray(r.permissions)) {
    throw new ConfigValidationError(
      'permissions must be an array',
      `roles.${name}.permissions`,
    );
  }
  if (r.deny !== undefined && !Array.isArray(r.deny)) {
    throw new ConfigValidationError(
      'deny must be an array',
      `roles.${name}.deny`,
    );
  }
  if (
    r.rateLimit !== undefined &&
    r.rateLimit !== null &&
    typeof r.rateLimit !== 'number'
  ) {
    throw new ConfigValidationError(
      'rateLimit must be a number or null',
      `roles.${name}.rateLimit`,
    );
  }
  if (r.maxMode !== undefined && typeof r.maxMode !== 'string') {
    throw new ConfigValidationError(
      'maxMode must be a string',
      `roles.${name}.maxMode`,
    );
  }
}

function validateUser(userId: string, user: unknown): void {
  if (!user || typeof user !== 'object') {
    throw new ConfigValidationError(
      `user "${userId}" must be an object`,
      `users.${userId}`,
    );
  }
  const u = user as Record<string, unknown>;
  if (typeof u.name !== 'string') {
    throw new ConfigValidationError(
      'name must be a string',
      `users.${userId}.name`,
    );
  }
  if (!Array.isArray(u.roles)) {
    throw new ConfigValidationError(
      'roles must be an array',
      `users.${userId}.roles`,
    );
  }
  if (u.permissions !== undefined && !Array.isArray(u.permissions)) {
    throw new ConfigValidationError(
      'permissions must be an array',
      `users.${userId}.permissions`,
    );
  }
  if (u.deny !== undefined && !Array.isArray(u.deny)) {
    throw new ConfigValidationError(
      'deny must be an array',
      `users.${userId}.deny`,
    );
  }
  if (
    u.rateLimit !== undefined &&
    u.rateLimit !== null &&
    typeof u.rateLimit !== 'number'
  ) {
    throw new ConfigValidationError(
      'rateLimit must be a number or null',
      `users.${userId}.rateLimit`,
    );
  }
}
