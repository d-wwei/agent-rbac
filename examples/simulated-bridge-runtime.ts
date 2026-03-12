import {
  EnforcementPipeline,
  FileConfigLoader,
  FileSystemMemoryStore,
  RateLimiter,
} from '../src/index.js';
import type { RbacAdapter } from '../src/types.js';

const adapter: RbacAdapter = {
  mapToolPermission(toolName) {
    if (toolName === 'Read') return 'agent.file.read';
    if (toolName === 'Bash') return 'agent.bash.write';
    return null;
  },
  extractFilePaths(toolCall) {
    if (toolCall.args && typeof toolCall.args.file_path === 'string') {
      return [toolCall.args.file_path];
    }
    return toolCall.filePaths ?? [];
  },
};

const pipeline = new EnforcementPipeline({
  configLoader: new FileConfigLoader('./permissions.json'),
  adapter,
  rateLimiter: new RateLimiter({ windowMs: 60_000 }),
  contextLoaderOpts: {
    memoryStore: new FileSystemMemoryStore('./memory'),
  },
});

const result = await pipeline.enforceAsync({
  userId: 'alice',
  message: '/sessions',
  command: '/sessions',
  currentMode: 'plan',
});

console.log(JSON.stringify(result, null, 2));
