/**
 * Layer 1: Gateway — rate limiting + message.send permission check.
 */

import type { EnforcementContext, EnforcementResult, EnforcementLayer } from '../types.js';
import { hasPermission } from '../core/permission-resolver.js';
import { RateLimiter } from '../core/rate-limiter.js';
import { formatReason } from '../core/messages.js';

export function createGatewayLayer(rateLimiter: RateLimiter): EnforcementLayer {
  return (ctx: EnforcementContext): EnforcementResult | null => {
    // Rate limit check
    if (!rateLimiter.check(ctx.userId, ctx.user)) {
      return {
        allowed: false,
        deniedBy: 'gateway',
        code: 'gateway.rate_limit',
        reason: formatReason('gateway.rate_limit', {}, ctx.locale),
        trace: {
          evaluatedLayers: ['gateway'],
          effectiveRole: ctx.user.topRole,
          effectivePermissions: Array.from(ctx.user.permissions).sort(),
          deniedBy: 'gateway',
          denialCode: 'gateway.rate_limit',
        },
      };
    }

    // message.send permission check
    if (!hasPermission(ctx.user, 'message.send')) {
      return {
        allowed: false,
        deniedBy: 'gateway',
        code: 'gateway.message_send',
        reason: formatReason('gateway.message_send', {}, ctx.locale),
        trace: {
          evaluatedLayers: ['gateway'],
          effectiveRole: ctx.user.topRole,
          effectivePermissions: Array.from(ctx.user.permissions).sort(),
          deniedBy: 'gateway',
          denialCode: 'gateway.message_send',
        },
      };
    }

    return null; // pass through
  };
}
