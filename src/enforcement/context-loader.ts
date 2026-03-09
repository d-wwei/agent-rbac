/**
 * Layer 3: Context Isolation — load memory based on user role.
 *
 * Owner: full agent context
 * Others: public memory + own user memory only
 */

import type {
  EnforcementContext,
  EnforcementResult,
  EnforcementLayer,
  MemoryStore,
} from '../types.js';

export interface ContextLoaderOptions {
  memoryStore?: MemoryStore;
  publicMemoryKeys?: string[];
  ownerMemoryKeys?: string[];
}

export function createContextLoaderLayer(
  opts: ContextLoaderOptions = {},
): EnforcementLayer {
  return (ctx: EnforcementContext): EnforcementResult | null => {
    const isOwner = ctx.user.topRole === 'owner';

    const memoryScope = isOwner
      ? { type: 'owner' as const, loadAll: true }
      : {
          type: 'user' as const,
          userId: ctx.userId,
          publicKeys: opts.publicMemoryKeys ?? ['guidelines', 'faq'],
        };

    return {
      allowed: true,
      context: {
        memoryScope,
        memoryStore: opts.memoryStore,
      },
    };
  };
}
