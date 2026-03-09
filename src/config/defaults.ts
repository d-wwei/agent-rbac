/**
 * Default configuration — fail-closed guest role.
 */

import type { PermissionConfig, ModeHierarchy } from '../types.js';

export const DEFAULT_CONFIG: PermissionConfig = {
  owner: '',
  roles: {
    guest: {
      name: 'guest',
      permissions: ['message.send'],
      deny: [],
      rateLimit: 20,
      maxMode: 'ask',
    },
  },
  users: {},
  defaults: { unknownUserRole: 'guest' },
};

export const DEFAULT_MODE_HIERARCHY: ModeHierarchy = {
  levels: { ask: 1, plan: 2, code: 3 },
};
