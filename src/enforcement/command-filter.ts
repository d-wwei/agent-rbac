/**
 * Layer 2: Command Filter — check command-specific permissions.
 */

import type { EnforcementContext, EnforcementResult, EnforcementLayer } from '../types.js';
import { hasPermission } from '../core/permission-resolver.js';
import { CommandMapper } from '../core/command-mapper.js';

export function createCommandFilterLayer(
  commandMapper: CommandMapper,
): EnforcementLayer {
  return (ctx: EnforcementContext): EnforcementResult | null => {
    if (!ctx.command) return null; // Not a command, pass through

    const requiredPerm = commandMapper.getPermission(
      ctx.command,
      ctx.commandArgs,
    );

    // null means always allowed or unknown command
    if (requiredPerm === null) return null;

    if (!hasPermission(ctx.user, requiredPerm)) {
      return {
        allowed: false,
        deniedBy: 'command-filter',
        reason: `这个命令目前不在你的权限范围内。`,
      };
    }

    return null; // pass through
  };
}
