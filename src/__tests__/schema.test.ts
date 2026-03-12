import { describe, it, expect } from 'vitest';
import {
  validateConfig,
  validateConfigSemantics,
  ConfigValidationError,
} from '../config/schema.js';
import type { PermissionConfig } from '../types.js';

const baseConfig: PermissionConfig = {
  owner: 'owner_001',
  roles: {
    guest: {
      name: 'Guest',
      permissions: ['message.send'],
      rateLimit: 20,
      maxMode: 'ask',
    },
  },
  users: {
    user_a: { name: 'Alice', roles: ['guest'] },
  },
  defaults: { unknownUserRole: 'guest' },
};

describe('validateConfigSemantics', () => {
  it('accepts valid config', () => {
    expect(validateConfigSemantics(validateConfig(baseConfig))).toEqual(baseConfig);
  });

  it('rejects missing default role', () => {
    expect(() =>
      validateConfigSemantics({
        ...baseConfig,
        defaults: { unknownUserRole: 'missing' },
      }),
    ).toThrow(ConfigValidationError);
  });

  it('rejects user roles that do not exist', () => {
    expect(() =>
      validateConfigSemantics({
        ...baseConfig,
        users: {
          user_a: { name: 'Alice', roles: ['nope'] },
        },
      }),
    ).toThrow(/references missing role/);
  });

  it('rejects unknown maxMode when hierarchy is provided', () => {
    expect(() =>
      validateConfigSemantics(
        {
          ...baseConfig,
          roles: {
            guest: {
              name: 'Guest',
              permissions: ['message.send'],
              maxMode: 'wizard',
            },
          },
        },
        { hierarchy: { levels: { ask: 1, plan: 2 } } },
      ),
    ).toThrow(/unknown maxMode/);
  });
});
