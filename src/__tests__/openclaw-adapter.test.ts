import { describe, it, expect } from 'vitest';
import { OpenClawAdapter } from '../adapters/openclaw.js';

describe('OpenClawAdapter', () => {
  it('normalizes message and leading slash command', async () => {
    const adapter = new OpenClawAdapter();
    const request = await adapter.normalizeRequest({
      userId: 'u1',
      sessionId: 's1',
      text: '/mode plan',
    });
    expect(request.identity.agentId).toBe('openclaw');
    expect(request.message.command).toBe('/mode');
    expect(request.message.commandArgs).toBe('plan');
  });

  it('extracts tool resources from args and file paths', async () => {
    const adapter = new OpenClawAdapter();
    const request = await adapter.normalizeRequest({
      userId: 'u1',
      sessionId: 's1',
      text: 'read file',
      toolCall: {
        toolName: 'file.read',
        args: { file_path: '/tmp/test.txt' },
        filePaths: ['/tmp/second.txt'],
      },
    });
    expect(request.toolIntent?.toolName).toBe('Read');
    expect(request.toolIntent?.resources?.map((resource) => resource.path)).toEqual([
      '/tmp/second.txt',
      '/tmp/test.txt',
    ]);
  });
});
