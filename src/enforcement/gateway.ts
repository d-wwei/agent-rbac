/**
 * Layer 1: Gateway — rate limiting + message.send permission check.
 */

import type { EnforcementContext, EnforcementResult, EnforcementLayer } from '../types.js';
import { hasPermission } from '../core/permission-resolver.js';
import { RateLimiter } from '../core/rate-limiter.js';

export function createGatewayLayer(rateLimiter: RateLimiter): EnforcementLayer {
  return (ctx: EnforcementContext): EnforcementResult | null => {
    // Rate limit check
    if (!rateLimiter.check(ctx.userId, ctx.user)) {
      return {
        allowed: false,
        deniedBy: 'gateway',
        reason: '你的消息发送频率已达上限，请稍后再试。',
      };
    }

    // message.send permission check
    if (!hasPermission(ctx.user, 'message.send')) {
      return {
        allowed: false,
        deniedBy: 'gateway',
        reason: '当前没有发送消息的权限。',
      };
    }

    return null; // pass through
  };
}
