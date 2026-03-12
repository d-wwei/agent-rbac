import type { HostResourceRef } from '../host/types.js';

export interface AdapterResourceInput {
  kind?: HostResourceRef['kind'];
  id?: string;
  path?: string;
  ownerUserId?: string;
  ownerTenantId?: string;
  sensitivity?: HostResourceRef['sensitivity'];
  tags?: string[];
}

export function coalesceText(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return '';
}

export function parseLeadingCommand(
  text: string,
): { command: string; args?: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const [command, ...rest] = trimmed.split(/\s+/);
  return {
    command,
    args: rest.length > 0 ? rest.join(' ') : undefined,
  };
}

export function normalizeToolName(
  toolName: string,
  aliases: Record<string, string>,
): string {
  const lowered = toolName.toLowerCase();
  return aliases[lowered] ?? toolName;
}

export function normalizeResources(input: {
  resources?: AdapterResourceInput[];
  filePaths?: string[];
  args?: Record<string, unknown>;
}): HostResourceRef[] {
  const explicit = input.resources?.map((resource) => ({
    kind: resource.kind ?? inferResourceKind(resource.path),
    id: resource.id,
    path: resource.path,
    ownerUserId: resource.ownerUserId,
    ownerTenantId: resource.ownerTenantId,
    sensitivity: resource.sensitivity,
    tags: resource.tags,
  })) ?? [];
  const filePaths = [
    ...(input.filePaths ?? []),
    ...extractPathsFromArgs(input.args),
  ].map((filePath) => ({
    kind: inferResourceKind(filePath),
    path: filePath,
  }));
  return dedupeResources([...explicit, ...filePaths]);
}

export function extractPathsFromArgs(
  args: Record<string, unknown> | undefined,
): string[] {
  if (!args) return [];
  const paths: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && looksLikePathKey(key)) {
      paths.push(value);
      continue;
    }
    if (!Array.isArray(value) || !looksLikePathKey(key)) {
      continue;
    }
    for (const item of value) {
      if (typeof item === 'string') {
        paths.push(item);
      }
    }
  }
  return paths;
}

function dedupeResources(resources: HostResourceRef[]): HostResourceRef[] {
  const seen = new Set<string>();
  const results: HostResourceRef[] = [];
  for (const resource of resources) {
    const key = `${resource.kind}:${resource.id ?? ''}:${resource.path ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(resource);
  }
  return results;
}

function looksLikePathKey(key: string): boolean {
  return [
    'path',
    'paths',
    'file',
    'files',
    'file_path',
    'file_paths',
    'cwd',
    'target',
    'targets',
  ].includes(key.toLowerCase());
}

function inferResourceKind(pathValue?: string): HostResourceRef['kind'] {
  if (!pathValue) return 'custom';
  if (pathValue.includes('memory')) return 'memory';
  if (pathValue.endsWith('.json')) return 'config';
  return 'file';
}
