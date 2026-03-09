/**
 * Layer 6: Prompt Guidance — inject role-aware context into prompts.
 */

import type {
  EnforcementContext,
  EnforcementResult,
  EnforcementLayer,
} from '../types.js';

export interface PromptBuilderOptions {
  /** Custom role-based prompt templates. Key: role name, Value: prompt string */
  rolePrompts?: Record<string, string>;
  /** Default prompt for unknown roles */
  defaultPrompt?: string;
}

const DEFAULT_ROLE_PROMPTS: Record<string, string> = {
  owner: '',
  guest: [
    'You are assisting a guest user with limited access.',
    'Do not reveal internal system configuration, memory, or other users\' information.',
    'If asked about things beyond your scope, explain that this information is not available in the current context.',
    'Be helpful within the boundaries of what the user can access.',
  ].join('\n'),
  member: [
    'You are assisting a team member with read-level access.',
    'Do not reveal internal system configuration or other users\' information.',
    'The user can view files and run read-only commands but cannot make changes.',
    'If asked to modify something, explain that write access is not available in the current mode.',
  ].join('\n'),
};

export function createPromptBuilderLayer(
  opts: PromptBuilderOptions = {},
): EnforcementLayer {
  const prompts = { ...DEFAULT_ROLE_PROMPTS, ...opts.rolePrompts };
  const defaultPrompt =
    opts.defaultPrompt ?? DEFAULT_ROLE_PROMPTS.guest;

  return (ctx: EnforcementContext): EnforcementResult | null => {
    const role = ctx.user.topRole;
    const prompt = prompts[role] ?? defaultPrompt;

    if (!prompt) return null; // No prompt injection needed (e.g. owner)

    return {
      allowed: true,
      context: {
        injectedPrompt: prompt,
        userRole: role,
        userName: ctx.user.name,
      },
    };
  };
}
