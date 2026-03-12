import type { RbacAdapter } from '../types.js';

const READ_TOOLS = new Set([
  'read',
  'ls',
  'glob',
  'find',
  'grep',
  'searchfiles',
  'listfiles',
  'file.read',
  'file.search',
  'filesystem.read',
]);

const WRITE_TOOLS = new Set([
  'edit',
  'write',
  'multiedit',
  'replace',
  'applypatch',
  'file.write',
  'filesystem.write',
]);

const SHELL_TOOLS = new Set([
  'bash',
  'shell',
  'exec',
  'terminal',
  'runcommand',
]);

const WEB_TOOLS = new Set([
  'websearch',
  'webfetch',
  'search',
  'fetch',
]);

export function createHostPermissionAdapter(
  host: 'openclaw' | 'claude-code' | 'codex',
): RbacAdapter {
  return {
    mapToolPermission(toolName) {
      const normalized = toolName.trim().toLowerCase();
      if (READ_TOOLS.has(normalized)) return 'agent.file.read';
      if (WRITE_TOOLS.has(normalized)) return 'agent.file.write';
      if (SHELL_TOOLS.has(normalized)) return 'agent.bash.write';
      if (WEB_TOOLS.has(normalized)) return 'agent.web.search';
      if (host === 'openclaw' && normalized === 'gateway') return 'bridge.mode.ask';
      return null;
    },
    extractFilePaths(toolCall) {
      const args = toolCall.args ?? {};
      const values: string[] = [];
      const keys = ['file_path', 'path', 'cwd', 'target'];
      for (const key of keys) {
        const value = args[key];
        if (typeof value === 'string') {
          values.push(value);
        }
      }
      for (const key of ['paths', 'file_paths', 'targets']) {
        const value = args[key];
        if (!Array.isArray(value)) continue;
        for (const item of value) {
          if (typeof item === 'string') {
            values.push(item);
          }
        }
      }
      return toolCall.filePaths?.length ? [...toolCall.filePaths, ...values] : values;
    },
  };
}
