/**
 * Command-to-permission mapper with registerable commands.
 *
 * Default mappings for bridge commands are built in.
 * Consumers can register additional commands.
 */

import type { CommandMapping } from '../types.js';

// ── Built-in bridge command defaults ─────────────────────────────

const BRIDGE_COMMAND_DEFAULTS: CommandMapping[] = [
  { command: '/new', permission: 'bridge.session.create' },
  { command: '/bind', permission: 'bridge.session.create' },
  { command: '/clear', permission: 'bridge.session.clear' },
  { command: '/mode', permission: 'bridge.mode', appendArgs: true },
  { command: '/cwd', permission: 'bridge.workdir.change' },
  { command: '/status', permission: 'bridge.status' },
  { command: '/sessions', permission: 'bridge.session.list' },
  { command: '/lsessions', permission: 'bridge.session.list' },
  { command: '/switchto', permission: 'bridge.session.switch' },
  { command: '/rename', permission: 'bridge.session.rename' },
  { command: '/archive', permission: 'bridge.session.archive' },
  { command: '/unarchive', permission: 'bridge.session.archive' },
  { command: '/perm', permission: 'bridge.permission.respond' },
  // Always allowed
  { command: '/start', permission: null },
  { command: '/help', permission: null },
  { command: '/stop', permission: null },
];

// ── CommandMapper ────────────────────────────────────────────────

export class CommandMapper {
  private readonly mappings = new Map<string, CommandMapping>();
  private readonly strict: boolean;

  constructor(
    presets: CommandMapping[] = BRIDGE_COMMAND_DEFAULTS,
    opts?: { strict?: boolean },
  ) {
    this.strict = opts?.strict ?? true;
    for (const mapping of presets) {
      this.mappings.set(mapping.command, mapping);
    }
  }

  /**
   * Register a command mapping. Overwrites existing mapping for the same command.
   */
  register(mapping: CommandMapping): void {
    this.mappings.set(mapping.command, mapping);
  }

  /**
   * Register multiple mappings at once.
   */
  registerAll(mappings: CommandMapping[]): void {
    for (const m of mappings) this.register(m);
  }

  /**
   * Unregister a command.
   */
  unregister(command: string): void {
    this.mappings.delete(command);
  }

  /**
   * Get the required permission for a command.
   * Returns:
   * - string: required permission
   * - null: explicitly always allowed
   * - undefined: unknown command in strict mode
   */
  getPermission(command: string, args?: string): string | null | undefined {
    const mapping = this.mappings.get(command);
    if (!mapping) return this.strict ? undefined : null;
    if (mapping.permission === null) return null;
    if (mapping.appendArgs && args) {
      return `${mapping.permission}.${args}`;
    }
    return mapping.permission;
  }

  /**
   * Check if a command is registered.
   */
  has(command: string): boolean {
    return this.mappings.has(command);
  }

  /**
   * List all registered commands.
   */
  list(): CommandMapping[] {
    return Array.from(this.mappings.values());
  }

  isStrict(): boolean {
    return this.strict;
  }
}
