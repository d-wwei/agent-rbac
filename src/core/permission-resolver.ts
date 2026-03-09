/**
 * Permission resolution — pure functions that accept config as parameter.
 *
 * resolveUser: userId + config → UserPermissions
 * hasPermission: UserPermissions + permission string → boolean
 */

import type {
  PermissionConfig,
  UserPermissions,
  ModeHierarchy,
} from '../types.js';
import { DEFAULT_MODE_HIERARCHY } from '../config/defaults.js';

/**
 * Resolve a userId to merged permissions.
 * Pure function — caller provides the config.
 */
export function resolveUser(
  config: PermissionConfig,
  userId: string,
  hierarchy: ModeHierarchy = DEFAULT_MODE_HIERARCHY,
): UserPermissions {
  // Owner shortcut
  if (userId && userId === config.owner) {
    const maxLevel = Math.max(...Object.values(hierarchy.levels));
    const maxMode =
      Object.entries(hierarchy.levels).find(
        ([, v]) => v === maxLevel,
      )?.[0] ?? 'code';
    return {
      userId,
      name: 'owner',
      topRole: 'owner',
      permissions: new Set(['*']),
      deny: new Set(),
      rateLimit: null,
      maxMode,
    };
  }

  // Named user or fall back to default role
  const userDef = config.users[userId];
  const roleNames = userDef?.roles ?? [config.defaults.unknownUserRole];

  const permissions = new Set<string>();
  const deny = new Set<string>();
  let rateLimit: number | null = null;
  let maxModeLevel = 0;
  let topRole = roleNames[0] || 'guest';
  const userName = userDef?.name || 'unknown';

  for (const roleName of roleNames) {
    const role = config.roles[roleName];
    if (!role) continue;
    for (const p of role.permissions) permissions.add(p);
    if (role.deny) for (const d of role.deny) deny.add(d);
    if (role.rateLimit != null) {
      rateLimit =
        rateLimit == null ? role.rateLimit : Math.max(rateLimit, role.rateLimit);
    }
    const mLevel = hierarchy.levels[role.maxMode || 'ask'] ?? 1;
    if (mLevel > maxModeLevel) {
      maxModeLevel = mLevel;
      topRole = roleName;
    }
  }

  // Direct user permissions / deny
  if (userDef?.permissions) {
    for (const p of userDef.permissions) permissions.add(p);
  }
  if (userDef?.deny) {
    for (const d of userDef.deny) deny.add(d);
  }
  if (userDef?.rateLimit != null) {
    rateLimit = userDef.rateLimit;
  }

  // Remove denied from granted
  for (const d of deny) permissions.delete(d);

  // Resolve max mode from level
  let maxMode = 'ask';
  for (const [mode, level] of Object.entries(hierarchy.levels)) {
    if (level === maxModeLevel) {
      maxMode = mode;
      break;
    }
  }

  return { userId, name: userName, topRole, permissions, deny, rateLimit, maxMode };
}

/**
 * Check if user has a specific permission.
 * Supports wildcard '*' (owner) and prefix wildcards like 'bridge.*'.
 */
export function hasPermission(
  user: UserPermissions,
  permission: string,
): boolean {
  if (user.permissions.has('*')) return true;
  if (user.deny.has(permission)) return false;
  if (user.permissions.has(permission)) return true;

  // Check wildcard prefixes: bridge.* matches bridge.mode.code
  for (const p of user.permissions) {
    if (p.endsWith('.*')) {
      const prefix = p.slice(0, -1); // 'bridge.'
      if (permission.startsWith(prefix)) return true;
    }
  }
  return false;
}
