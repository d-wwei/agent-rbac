#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileConfigLoader } from './config/loader.js';
import { FileSystemMemoryStore } from './memory/memory-store.js';
import { FileSystemAuditStore } from './audit/store.js';
import { AuditService } from './audit/service.js';
import { FileSystemAdaptiveStore } from './adaptive/store.js';
import { AdaptivePolicyCopilot } from './adaptive/service.js';
import { OpenClawAdapter } from './adapters/openclaw.js';
import { ClaudeCodeAdapter } from './adapters/claude-code.js';
import { CodexAdapter } from './adapters/codex.js';
import { createHostPermissionAdapter } from './adapters/permission-mappers.js';
import { AgentSecurityRuntime } from './runtime/security-runtime.js';
import type { OpenClawGatewayRequest } from './adapters/openclaw.js';
import type { ClaudeCodeRequest } from './adapters/claude-code.js';
import type { CodexRequest } from './adapters/codex.js';

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'evaluate':
      await runEvaluate(args);
      return;
    case 'audit':
      await runAudit(args);
      return;
    case 'review':
      await runReview(args);
      return;
    case 'suggestions':
      await runSuggestions(args);
      return;
    case 'familiarity':
      await runFamiliarity(args);
      return;
    case 'openclaw':
      await runOpenClaw(args);
      return;
    case 'help':
    case undefined:
      printHelp();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function runEvaluate(args: string[]): Promise<void> {
  const options = parseFlags(args);
  const configPath = requiredFlag(options, '--config');
  const stateDir = requiredFlag(options, '--state-dir');
  const requestPath = requiredFlag(options, '--request');
  const host = options['--host'] ?? 'openclaw';
  const runtime = createRuntime(configPath, stateDir, host);
  const rawRequest = JSON.parse(fs.readFileSync(requestPath, 'utf-8')) as
    | OpenClawGatewayRequest
    | ClaudeCodeRequest
    | CodexRequest;
  const result = await runtime.evaluate(rawRequest);
  process.stdout.write(JSON.stringify(result.decision, null, 2) + '\n');
}

async function runAudit(args: string[]): Promise<void> {
  const options = parseFlags(args);
  const stateDir = requiredFlag(options, '--state-dir');
  const store = new FileSystemAuditStore(path.join(stateDir, 'audit'));
  const service = new AuditService(store);
  const subcommand = options._[0] ?? 'timeline';
  if (subcommand === 'timeline') {
    const decisions = await store.listDecisions({
      userId: options['--user'],
      tenantId: options['--tenant'],
      sessionId: options['--session'],
      limit: options['--limit'] ? Number(options['--limit']) : 50,
    });
    process.stdout.write(JSON.stringify(decisions, null, 2) + '\n');
    return;
  }
  if (subcommand === 'weekly-report') {
    const report = await service.buildWeeklyReport({
      tenantId: options['--tenant'],
      agentId: options['--agent'],
      startDate: requiredFlag(options, '--start'),
      endDate: requiredFlag(options, '--end'),
    });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }
  if (subcommand === 'heatmap') {
    const heatmap = await service.buildHeatmap({
      tenantId: options['--tenant'],
      agentId: options['--agent'],
      startDate: options['--start'],
      endDate: options['--end'],
    });
    process.stdout.write(JSON.stringify(heatmap, null, 2) + '\n');
    return;
  }
  throw new Error(`Unknown audit subcommand: ${subcommand}`);
}

async function runReview(args: string[]): Promise<void> {
  const options = parseFlags(args);
  const configPath = requiredFlag(options, '--config');
  const stateDir = requiredFlag(options, '--state-dir');
  const runtime = createRuntime(configPath, stateDir, options['--host'] ?? 'openclaw');
  await runtime.reviewDecision({
    decisionId: requiredFlag(options, '--decision'),
    reviewerId: requiredFlag(options, '--reviewer'),
    status: requiredFlag(options, '--status') as 'correct' | 'too_strict' | 'too_permissive' | 'policy_bug' | 'adapter_bug',
    note: options['--note'],
  });
  process.stdout.write('OK\n');
}

async function runSuggestions(args: string[]): Promise<void> {
  const options = parseFlags(args);
  const stateDir = requiredFlag(options, '--state-dir');
  const copilot = new AdaptivePolicyCopilot(new FileSystemAdaptiveStore(path.join(stateDir, 'adaptive')));
  const suggestions = await copilot.getSuggestions(options['--user']);
  process.stdout.write(JSON.stringify(suggestions, null, 2) + '\n');
}

async function runFamiliarity(args: string[]): Promise<void> {
  const options = parseFlags(args);
  const stateDir = requiredFlag(options, '--state-dir');
  const copilot = new AdaptivePolicyCopilot(new FileSystemAdaptiveStore(path.join(stateDir, 'adaptive')));
  const familiarity = await copilot.getFamiliarity(requiredFlag(options, '--user'));
  process.stdout.write(JSON.stringify(familiarity, null, 2) + '\n');
}

async function runOpenClaw(args: string[]): Promise<void> {
  const options = parseFlags(args);
  const subcommand = options._[0] ?? 'help';
  if (subcommand === 'install') {
    runOpenClawInstall(options);
    return;
  }
  if (subcommand === 'smoke') {
    runOpenClawSmoke(options);
    return;
  }
  printHelp();
}

function createRuntime(
  configPath: string,
  stateDir: string,
  host: string,
): AgentSecurityRuntime<OpenClawGatewayRequest | ClaudeCodeRequest | CodexRequest> {
  const auditStore = new FileSystemAuditStore(path.join(stateDir, 'audit'));
  const adaptiveStore = new FileSystemAdaptiveStore(path.join(stateDir, 'adaptive'));
  const hostAdapter = resolveHostAdapter(host);
  return new AgentSecurityRuntime({
    configLoader: new FileConfigLoader(configPath),
    hostAdapter,
    auditService: new AuditService(auditStore, {
      hostType: host,
      policyVersion: 'v1',
      runtimeVersion: 'v1',
    }),
    adaptiveCopilot: new AdaptivePolicyCopilot(adaptiveStore),
    adapterPermissionMapper: createHostPermissionAdapter(
      host as 'openclaw' | 'claude-code' | 'codex',
    ),
    pipeline: {
      contextLoaderOpts: {
        memoryStore: new FileSystemMemoryStore(path.join(stateDir, 'memory')),
      },
      locale: 'zh-CN',
    },
  });
}

function resolveHostAdapter(
  host: string,
): OpenClawAdapter | ClaudeCodeAdapter | CodexAdapter {
  switch (host) {
    case 'openclaw':
      return new OpenClawAdapter();
    case 'claude-code':
      return new ClaudeCodeAdapter();
    case 'codex':
      return new CodexAdapter();
    default:
      throw new Error(`Unsupported host: ${host}`);
  }
}

function runOpenClawInstall(
  options: Record<string, string> & { _: string[] },
): void {
  const repoRoot = process.cwd();
  const openclawBin = options['--openclaw-bin'] ?? 'openclaw';
  const permissionsConfigPath = resolveCliPath(
    requiredFlag(options, '--permissions-config'),
  );
  const stateDir = resolveCliPath(
    options['--state-dir'] ?? path.join(os.homedir(), '.openclaw', 'agent-rbac-state'),
  );
  const openclawConfigPath = resolveCliPath(
    options['--openclaw-config'] ?? path.join(os.homedir(), '.openclaw', 'openclaw.json'),
  );
  const config = JSON.parse(fs.readFileSync(openclawConfigPath, 'utf-8')) as Record<string, unknown>;
  const preInstall = ensurePluginConfigured(config, {
    permissionsConfigPath,
    stateDir,
    locale: options['--locale'] ?? 'zh-CN',
    includeAllow: false,
  });
  fs.writeFileSync(openclawConfigPath, JSON.stringify(preInstall, null, 2) + '\n', 'utf-8');

  const installArgs = ['plugins', 'install'];
  if (options['--link'] !== 'false') {
    installArgs.push('--link');
  }
  installArgs.push(repoRoot);
  execFileSync(openclawBin, installArgs, { stdio: 'inherit' });
  const installedConfig = JSON.parse(fs.readFileSync(openclawConfigPath, 'utf-8')) as Record<string, unknown>;
  const next = ensurePluginConfigured(installedConfig, {
    permissionsConfigPath,
    stateDir,
    locale: options['--locale'] ?? 'zh-CN',
    includeAllow: true,
  });
  fs.writeFileSync(openclawConfigPath, JSON.stringify(next, null, 2) + '\n', 'utf-8');
  process.stdout.write(
    `Configured OpenClaw plugin in ${openclawConfigPath}\n`,
  );
}

function runOpenClawSmoke(
  options: Record<string, string> & { _: string[] },
): void {
  const openclawBin = options['--openclaw-bin'] ?? 'openclaw';
  const url = options['--url'] ?? 'ws://127.0.0.1:19081';
  const params = {
    requests: [
      {
        userId: 'smoke-user',
        sessionId: 'smoke-session',
        text: '/mode code',
      },
    ],
    subagents: [
      {
        sessionKey: 'agent:main:subagent:rbac-smoke-a',
        message: options['--message-a'] ?? 'Say "subagent A online" and stop.',
        timeoutMs: 45_000,
      },
      {
        sessionKey: 'agent:main:subagent:rbac-smoke-b',
        message: options['--message-b'] ?? 'Say "subagent B online" and stop.',
        timeoutMs: 45_000,
      },
    ],
  };
  const gatewayArgs = [
    'gateway',
    'call',
    'agent_rbac.smoke',
    '--json',
    '--url',
    url,
    '--timeout',
    options['--timeout'] ?? '120000',
    '--params',
    JSON.stringify(params),
  ];
  if (options['--token']) {
    gatewayArgs.push('--token', options['--token']);
  }
  const output = execFileSync(openclawBin, gatewayArgs, {
    encoding: 'utf-8',
  });
  process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
}

function parseFlags(args: string[]): Record<string, string> & { _: string[] } {
  const result = { _: [] as string[] } as Record<string, string> & { _: string[] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      const next = args[index + 1];
      if (!next || next.startsWith('--')) {
        result[arg] = 'true';
      } else {
        result[arg] = next;
        index += 1;
      }
      continue;
    }
    result._.push(arg);
  }
  return result;
}

function requiredFlag(options: Record<string, string>, flag: string): string {
  const value = options[flag];
  if (!value) {
    throw new Error(`Missing required flag: ${flag}`);
  }
  return value;
}

function resolveCliPath(input: string): string {
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return path.resolve(input);
}

function ensurePluginConfigured(
  config: Record<string, unknown>,
  params: {
    permissionsConfigPath: string;
    stateDir: string;
    locale: string;
    includeAllow: boolean;
  },
): Record<string, unknown> {
  const next = structuredClone(config);
  const hooks = isRecord(next.hooks) ? next.hooks : {};
  const internal = isRecord(hooks.internal) ? hooks.internal : {};
  internal.enabled = true;
  hooks.internal = internal;
  next.hooks = hooks;

  const plugins = isRecord(next.plugins) ? next.plugins : {};
  const entries = isRecord(plugins.entries) ? plugins.entries : {};
  entries['agent-rbac'] = {
    enabled: true,
    config: {
      permissionsConfigPath: params.permissionsConfigPath,
      stateDir: params.stateDir,
      locale: params.locale,
      promptGuard: true,
      toolGuard: true,
      gatewayMethods: true,
    },
  };
  if (params.includeAllow) {
    const allow = Array.isArray(plugins.allow)
      ? plugins.allow.filter((value): value is string => typeof value === 'string')
      : [];
    if (!allow.includes('agent-rbac')) {
      allow.push('agent-rbac');
    }
    plugins.allow = allow;
  }
  plugins.entries = entries;
  next.plugins = plugins;
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function printHelp(): void {
  process.stdout.write([
    'agent-rbac CLI',
    '',
    'Commands:',
    '  evaluate --config permissions.json --state-dir .agent-rbac --request request.json [--host openclaw]',
    '  audit timeline --state-dir .agent-rbac [--user USER] [--tenant TENANT] [--session SESSION] [--limit 50]',
    '  audit weekly-report --state-dir .agent-rbac --start ISO --end ISO [--tenant TENANT] [--agent AGENT]',
    '  audit heatmap --state-dir .agent-rbac [--start ISO] [--end ISO] [--tenant TENANT] [--agent AGENT]',
    '  review --config permissions.json --state-dir .agent-rbac --decision ID --reviewer USER --status STATUS [--note TEXT]',
    '  suggestions --state-dir .agent-rbac [--user USER]',
    '  familiarity --state-dir .agent-rbac --user USER',
    '  openclaw install --permissions-config permissions.json [--state-dir ~/.openclaw/agent-rbac-state] [--openclaw-bin openclaw] [--link true]',
    '  openclaw smoke [--url ws://127.0.0.1:19081] [--openclaw-bin openclaw]',
  ].join('\n') + '\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
