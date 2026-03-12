import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import OpenClawPlugin from '../openclaw-plugin.js';

type RegisteredHooks = Map<string, (event: unknown, ctx: unknown) => Promise<unknown> | unknown>;
type RegisteredMethods = Map<string, (options: {
  params: Record<string, unknown>;
  respond: (ok: boolean, payload?: unknown, error?: { message?: string }) => void;
}) => Promise<void> | void>;

function createMockApi(configPath: string, stateDir: string): {
  hooks: RegisteredHooks;
  methods: RegisteredMethods;
  loggerMessages: string[];
  api: {
    pluginConfig: Record<string, unknown>;
    logger: {
      info: (message: string) => void;
      warn: (message: string) => void;
      error: (message: string) => void;
      debug: (message: string) => void;
    };
    resolvePath: (input: string) => string;
    registerGatewayMethod: (method: string, handler: RegisteredMethods extends Map<
      string,
      infer T
    >
      ? T
      : never) => void;
    on: (hookName: string, handler: RegisteredHooks extends Map<string, infer T> ? T : never) => void;
    runtime: {
      subagent: {
        run: (params: { sessionKey: string; message: string }) => Promise<{ runId: string }>;
        waitForRun: () => Promise<{ status: 'ok' }>;
        getSessionMessages: (params: { sessionKey: string }) => Promise<{ messages: unknown[] }>;
      };
    };
  };
} {
  const hooks = new Map<string, RegisteredHooks extends Map<string, infer T> ? T : never>();
  const methods = new Map<string, RegisteredMethods extends Map<string, infer T> ? T : never>();
  const loggerMessages: string[] = [];
  return {
    hooks,
    methods,
    loggerMessages,
    api: {
      pluginConfig: {
        permissionsConfigPath: configPath,
        stateDir,
      },
      logger: {
        info: (message) => loggerMessages.push(message),
        warn: (message) => loggerMessages.push(message),
        error: (message) => loggerMessages.push(message),
        debug: (message) => loggerMessages.push(message),
      },
      resolvePath(input) {
        if (input.startsWith('~/')) {
          return path.join(os.homedir(), input.slice(2));
        }
        return path.resolve(input);
      },
      registerGatewayMethod(method, handler) {
        methods.set(method, handler);
      },
      on(hookName, handler) {
        hooks.set(hookName, handler);
      },
      runtime: {
        subagent: {
          async run(params) {
            return { runId: `run:${params.sessionKey}` };
          },
          async waitForRun() {
            return { status: 'ok' as const };
          },
          async getSessionMessages(params) {
            return {
              messages: [{ role: 'assistant', content: `reply for ${params.sessionKey}` }],
            };
          },
        },
      },
    },
  };
}

describe('OpenClaw plugin', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('injects refusal guidance for denied prompt turns', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-rbac-openclaw-plugin-'));
    tempDirs.push(dir);
    const configPath = path.join(dir, 'permissions.json');
    fs.writeFileSync(configPath, JSON.stringify({
      owner: 'owner',
      roles: {
        guest: {
          name: 'Guest',
          permissions: ['message.send', 'bridge.mode.ask'],
          maxMode: 'ask',
          rateLimit: 5,
        },
      },
      users: {},
      defaults: { unknownUserRole: 'guest' },
    }, null, 2));

    const { api, hooks } = createMockApi(configPath, path.join(dir, 'state'));
    OpenClawPlugin.register(api);

    const handler = hooks.get('before_prompt_build');
    expect(handler).toBeDefined();
    const result = await handler?.(
      { prompt: '/mode code', messages: [] },
      { sessionKey: 'agent:main:user:guest-1', sessionId: 's1', agentId: 'main' },
    ) as { prependContext?: string } | undefined;

    expect(result?.prependContext).toContain('denied');
  });

  it('blocks denied tool calls and exposes gateway smoke methods', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-rbac-openclaw-plugin-'));
    tempDirs.push(dir);
    const configPath = path.join(dir, 'permissions.json');
    fs.writeFileSync(configPath, JSON.stringify({
      owner: 'owner',
      roles: {
        guest: {
          name: 'Guest',
          permissions: ['message.send', 'bridge.mode.ask'],
          maxMode: 'ask',
          rateLimit: 5,
        },
      },
      users: {},
      defaults: { unknownUserRole: 'guest' },
      protectedPaths: {
        'info.agent.config.read': [configPath],
      },
    }, null, 2));

    const { api, hooks, methods } = createMockApi(configPath, path.join(dir, 'state'));
    OpenClawPlugin.register(api);

    const toolHandler = hooks.get('before_tool_call');
    const toolResult = await toolHandler?.(
      {
        toolName: 'Read',
        params: { path: configPath },
        runId: 'run-1',
      },
      {
        sessionKey: 'agent:main:user:guest-2',
        sessionId: 's2',
        agentId: 'main',
      },
    ) as { block?: boolean; blockReason?: string } | undefined;

    expect(toolResult?.block).toBe(true);
    expect(toolResult?.blockReason).toBeTruthy();

    const smoke = methods.get('agent_rbac.smoke');
    expect(smoke).toBeDefined();
    let response: unknown;
    await smoke?.({
      params: {
        requests: [{ userId: 'u1', sessionId: 's1', text: 'hello' }],
        subagents: [{ sessionKey: 'agent:main:subagent:test', message: 'ping' }],
      },
      respond(ok, payload, error) {
        response = ok ? payload : error;
      },
    });

    expect(response).toMatchObject({
      requestResults: expect.any(Array),
      subagentResults: [
        expect.objectContaining({
          sessionKey: 'agent:main:subagent:test',
          status: 'ok',
        }),
      ],
    });
  });
});
