/**
 * Layer 2: Command Filter — check command-specific permissions.
 */

import type { EnforcementContext, EnforcementResult, EnforcementLayer } from '../types.js';
import { hasPermission } from '../core/permission-resolver.js';
import { CommandMapper } from '../core/command-mapper.js';
import { formatReason } from '../core/messages.js';

export function createCommandFilterLayer(
  commandMapper: CommandMapper,
): EnforcementLayer {
  return (ctx: EnforcementContext): EnforcementResult | null => {
    if (!ctx.command) return null; // Not a command, pass through

    const requiredPerm = commandMapper.getPermission(
      ctx.command,
      ctx.commandArgs,
    );

    if (requiredPerm === undefined) {
      return {
        allowed: false,
        deniedBy: 'command-filter',
        code: 'command_filter.unknown',
        reason: formatReason('command_filter.unknown', {}, ctx.locale),
        trace: {
          evaluatedLayers: ['command-filter'],
          effectiveRole: ctx.user.topRole,
          effectivePermissions: Array.from(ctx.user.permissions).sort(),
          deniedBy: 'command-filter',
          denialCode: 'command_filter.unknown',
          commandPermission: undefined,
        },
      };
    }

    // null means explicitly always allowed
    if (requiredPerm === null) return null;

    if (!hasPermission(ctx.user, requiredPerm)) {
      return {
        allowed: false,
        deniedBy: 'command-filter',
        code: 'command_filter.forbidden',
        reason: formatReason('command_filter.forbidden', {}, ctx.locale),
        trace: {
          evaluatedLayers: ['command-filter'],
          effectiveRole: ctx.user.topRole,
          effectivePermissions: Array.from(ctx.user.permissions).sort(),
          deniedBy: 'command-filter',
          denialCode: 'command_filter.forbidden',
          commandPermission: requiredPerm,
        },
      };
    }

    return null; // pass through
  };
}
