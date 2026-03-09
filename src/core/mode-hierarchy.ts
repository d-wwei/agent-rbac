/**
 * Agent-agnostic mode hierarchy.
 *
 * No hardcoded modes — consumers define their own hierarchy.
 * Built-in default: ask(1) < plan(2) < code(3).
 */

import type { ModeHierarchy, UserPermissions } from '../types.js';
import { DEFAULT_MODE_HIERARCHY } from '../config/defaults.js';
import { hasPermission } from './permission-resolver.js';

/**
 * Create a custom mode hierarchy.
 */
export function createModeHierarchy(
  levels: Record<string, number>,
): ModeHierarchy {
  return { levels };
}

/**
 * Get the highest mode allowed for a user, checking bridge.mode.{mode} permissions.
 * Returns modes sorted from highest to lowest, returning the first one the user has.
 */
export function getMaxAllowedMode(
  user: UserPermissions,
  hierarchy: ModeHierarchy = DEFAULT_MODE_HIERARCHY,
): string {
  if (user.permissions.has('*')) {
    const maxLevel = Math.max(...Object.values(hierarchy.levels));
    return (
      Object.entries(hierarchy.levels).find(
        ([, v]) => v === maxLevel,
      )?.[0] ?? Object.keys(hierarchy.levels)[0]
    );
  }

  // Sort modes by level descending, return the highest the user is permitted
  const sorted = Object.entries(hierarchy.levels).sort(
    ([, a], [, b]) => b - a,
  );
  for (const [mode] of sorted) {
    if (hasPermission(user, `bridge.mode.${mode}`)) return mode;
  }

  // Fall back to lowest mode
  const lowest = sorted[sorted.length - 1];
  return lowest ? lowest[0] : 'ask';
}

/**
 * Check if a mode exceeds the allowed maximum.
 */
export function modeExceedsAllowed(
  currentMode: string,
  maxAllowed: string,
  hierarchy: ModeHierarchy = DEFAULT_MODE_HIERARCHY,
): boolean {
  const current = hierarchy.levels[currentMode] ?? 1;
  const max = hierarchy.levels[maxAllowed] ?? 1;
  return current > max;
}

/**
 * Get the level number for a mode.
 */
export function getModeLevel(
  mode: string,
  hierarchy: ModeHierarchy = DEFAULT_MODE_HIERARCHY,
): number {
  return hierarchy.levels[mode] ?? 0;
}
