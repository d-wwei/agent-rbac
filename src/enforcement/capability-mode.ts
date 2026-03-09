/**
 * Layer 4: Capability Mode — enforce agent mode based on permissions.
 */

import type {
  EnforcementContext,
  EnforcementResult,
  EnforcementLayer,
  ModeHierarchy,
} from '../types.js';
import {
  getMaxAllowedMode,
  modeExceedsAllowed,
} from '../core/mode-hierarchy.js';

export function createCapabilityModeLayer(
  hierarchy?: ModeHierarchy,
): EnforcementLayer {
  return (ctx: EnforcementContext): EnforcementResult | null => {
    const maxMode = getMaxAllowedMode(ctx.user, hierarchy);

    if (
      ctx.currentMode &&
      modeExceedsAllowed(ctx.currentMode, maxMode, hierarchy)
    ) {
      return {
        allowed: true, // Allow the message, but enforce mode downgrade
        deniedBy: undefined,
        enforcedMode: maxMode,
        context: {
          modeDowngraded: true,
          originalMode: ctx.currentMode,
          enforcedMode: maxMode,
        },
      };
    }

    return {
      allowed: true,
      enforcedMode: maxMode,
    };
  };
}
