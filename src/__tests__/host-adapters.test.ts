import { describe, expect, it } from 'vitest';
import { ClaudeCodeAdapter } from '../adapters/claude-code.js';
import { CodexAdapter } from '../adapters/codex.js';

describe('host adapters', () => {
  it('normalizes Claude Code prompt and tool inputs', async () => {
    const adapter = new ClaudeCodeAdapter();
    const request = await adapter.normalizeRequest({
      userId: 'u1',
      sessionId: 's1',
      prompt: '/mode plan',
      toolUse: {
        name: 'webfetch',
        input: {
          path: '/tmp/example.txt',
        },
      },
    });

    expect(request.identity.agentId).toBe('claude-code');
    expect(request.message.command).toBe('/mode');
    expect(request.message.commandArgs).toBe('plan');
    expect(request.toolIntent?.toolName).toBe('WebFetch');
    expect(request.toolIntent?.resources?.[0]?.path).toBe('/tmp/example.txt');
  });

  it('normalizes Codex tool calls and slash commands', async () => {
    const adapter = new CodexAdapter();
    const request = await adapter.normalizeRequest({
      userId: 'u1',
      sessionId: 's1',
      input: '/sessions',
      toolCall: {
        name: 'bash',
        arguments: {
          cwd: '/tmp/workspace',
        },
      },
    });

    expect(request.identity.agentId).toBe('codex');
    expect(request.message.command).toBe('/sessions');
    expect(request.toolIntent?.toolName).toBe('Bash');
    expect(request.toolIntent?.resources?.[0]?.path).toBe('/tmp/workspace');
  });
});
