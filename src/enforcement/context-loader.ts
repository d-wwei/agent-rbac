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
  AsyncEnforcementLayer,
  MemoryStore,
} from '../types.js';

export interface ContextLoaderOptions {
  memoryStore?: MemoryStore;
  publicMemoryKeys?: string[];
  ownerMemoryKeys?: string[];
  userMemoryKeys?: string[];
  publicMemoryUserId?: string;
  ownerMemoryUserId?: string;
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

export function createAsyncContextLoaderLayer(
  opts: ContextLoaderOptions = {},
): AsyncEnforcementLayer {
  return async (ctx: EnforcementContext): Promise<EnforcementResult> => {
    const isOwner = ctx.user.topRole === 'owner';
    const publicUserId = opts.publicMemoryUserId ?? '__public__';
    const ownerUserId = opts.ownerMemoryUserId ?? ctx.config.owner;
    const publicKeys = opts.publicMemoryKeys ?? ['guidelines', 'faq'];
    const userKeys = opts.userMemoryKeys ?? [
      'profile',
      'preferences',
      'memory',
      'sessions-index',
    ];
    const ownerKeys = opts.ownerMemoryKeys ?? userKeys;

    const loadedMemory = await loadScopedMemory(opts.memoryStore, {
      isOwner,
      currentUserId: ctx.userId,
      publicUserId,
      ownerUserId,
      publicKeys,
      userKeys,
      ownerKeys,
    });

    return {
      allowed: true,
      context: {
        memoryScope: isOwner
          ? { type: 'owner' as const, loadAll: true }
          : { type: 'user' as const, userId: ctx.userId, publicKeys },
        loadedMemory,
        memoryStore: opts.memoryStore,
      },
    };
  };
}

async function loadScopedMemory(
  store: MemoryStore | undefined,
  params: {
    isOwner: boolean;
    currentUserId: string;
    publicUserId: string;
    ownerUserId: string;
    publicKeys: string[];
    userKeys: string[];
    ownerKeys: string[];
  },
): Promise<Record<string, Record<string, string>>> {
  if (!store) return {};

  const publicEntries = await readKeys(store, params.publicUserId, params.publicKeys);
  if (params.isOwner) {
    const ownerEntries = await readKeys(store, params.ownerUserId, params.ownerKeys);
    return {
      public: publicEntries,
      owner: ownerEntries,
    };
  }

  const userEntries = await readKeys(store, params.currentUserId, params.userKeys);
  return {
    public: publicEntries,
    user: userEntries,
  };
}

async function readKeys(
  store: MemoryStore,
  userId: string,
  keys: string[],
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    keys.map(async (key) => {
      const value = await store.read(userId, key);
      return value == null ? null : [key, value] as const;
    }),
  );
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null));
}
