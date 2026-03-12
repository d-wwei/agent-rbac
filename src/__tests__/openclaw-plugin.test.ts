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

function createMockApi(
  configPath: string,
  stateDir: string,
  extraPluginConfig: Record<string, unknown> = {},
): {
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
        ...extraPluginConfig,
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

  it('parses timestamp-wrapped OpenClaw slash commands before enforcing permissions', async () => {
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

    const { api, hooks, methods } = createMockApi(configPath, path.join(dir, 'state'));
    OpenClawPlugin.register(api);

    const handler = hooks.get('before_prompt_build');
    await handler?.(
      { prompt: '[Fri 2026-03-13 02:53 GMT+8] /mode code', messages: [] },
      { sessionKey: 'agent:main:user:guest-3', sessionId: 's3', agentId: 'main' },
    );

    const timeline = methods.get('agent_rbac.audit.timeline');
    let response: unknown;
    await timeline?.({
      params: { sessionId: 's3', limit: 1 },
      respond(ok, payload, error) {
        response = ok ? payload : error;
      },
    });

    expect(response).toMatchObject({
      decisions: [
        expect.objectContaining({
          result: expect.objectContaining({
            allowed: false,
            code: 'command_filter.forbidden',
          }),
        }),
      ],
    });
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

  it('derives external identity from the OpenClaw session store by default', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-rbac-openclaw-plugin-'));
    tempDirs.push(dir);
    const configPath = path.join(dir, 'permissions.json');
    const stateDir = path.join(dir, 'state');
    const openClawStateDir = path.join(dir, '.openclaw');
    const sessionStorePath = path.join(openClawStateDir, 'agents', 'main', 'sessions', 'sessions.json');
    fs.mkdirSync(path.dirname(sessionStorePath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      owner: 'owner',
      roles: {
        guest: {
          name: 'Guest',
          permissions: ['message.send', 'bridge.mode.ask'],
          rateLimit: 5,
          maxMode: 'ask',
        },
      },
      users: {},
      defaults: { unknownUserRole: 'guest' },
    }, null, 2));
    fs.writeFileSync(sessionStorePath, JSON.stringify({
      'agent:main:discord:direct:1126411859080265778': {
        sessionId: 'session-discord-1',
        origin: {
          provider: 'discord',
          from: 'discord:1126411859080265778',
          to: 'channel:1479726948648222740',
          accountId: 'default',
        },
        lastChannel: 'discord',
        deliveryContext: {
          channel: 'discord',
          accountId: 'default',
        },
      },
    }, null, 2));

    const { api, hooks, methods } = createMockApi(
      configPath,
      stateDir,
      { openClawStateDir },
    );
    OpenClawPlugin.register(api);

    const promptHandler = hooks.get('before_prompt_build');
    await promptHandler?.(
      { prompt: 'hello', messages: [] },
      {
        sessionKey: 'agent:main:discord:direct:1126411859080265778',
        sessionId: 'ignored-session-id',
        agentId: 'main',
      },
    );

    const timeline = methods.get('agent_rbac.audit.timeline');
    let response: unknown;
    await timeline?.({
      params: {
        userId: 'external:discord:account:default:actor:1126411859080265778',
      },
      respond(ok, payload, error) {
        response = ok ? payload : error;
      },
    });

    expect(response).toMatchObject({
      decisions: [
        expect.objectContaining({
          actor: expect.objectContaining({
            userId: 'external:discord:account:default:actor:1126411859080265778',
            tenantId: 'external-tenant:discord:default',
          }),
        }),
      ],
    });
  });
});
