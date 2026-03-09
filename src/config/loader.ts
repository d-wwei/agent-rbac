/**
 * ConfigLoader implementations.
 *
 * - FileConfigLoader: reads/writes JSON file (hot-reload on every load)
 * - InMemoryConfigLoader: for testing
 * - EnvConfigLoader: locates config via environment variable
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ConfigLoader, PermissionConfig } from '../types.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { validateConfig } from './schema.js';

// ── File-based loader ────────────────────────────────────────────

export class FileConfigLoader implements ConfigLoader {
  constructor(
    private readonly configPath: string,
    private readonly ownerFallbackEnvVar?: string,
  ) {}

  load(): PermissionConfig {
    let raw = '';
    try {
      raw = fs.readFileSync(this.configPath, 'utf-8');
      return validateConfig(JSON.parse(raw));
    } catch {
      return this.recoverOwner(raw);
    }
  }

  save(config: PermissionConfig): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      this.configPath,
      JSON.stringify(config, null, 2) + '\n',
      'utf-8',
    );
  }

  /**
   * Three-tier owner recovery:
   * 1. Regex extraction from raw JSON (handles minor syntax errors)
   * 2. Environment variable fallback
   * 3. Empty owner (all users treated as guest)
   */
  private recoverOwner(raw: string): PermissionConfig {
    let owner = '';

    // Tier 1: regex extraction
    if (raw) {
      const m = raw.match(/"owner"\s*:\s*"([^"]+)"/);
      if (m) owner = m[1];
    }

    // Tier 2: env var fallback
    if (!owner && this.ownerFallbackEnvVar) {
      owner = process.env[this.ownerFallbackEnvVar] || '';
    }

    if (owner) {
      console.warn(
        '[agent-rbac] Config file unreadable; owner recovered from fallback',
      );
    } else {
      console.warn(
        '[agent-rbac] Config file unreadable; owner unknown — all users treated as guest',
      );
    }

    return { ...DEFAULT_CONFIG, owner };
  }
}

// ── In-memory loader (testing) ───────────────────────────────────

export class InMemoryConfigLoader implements ConfigLoader {
  constructor(private config: PermissionConfig) {}

  load(): PermissionConfig {
    return this.config;
  }

  save(config: PermissionConfig): void {
    this.config = config;
  }

  /** Update config in place (test helper) */
  update(partial: Partial<PermissionConfig>): void {
    this.config = { ...this.config, ...partial };
  }
}

// ── Env-based loader ─────────────────────────────────────────────

export class EnvConfigLoader implements ConfigLoader {
  private readonly delegate: FileConfigLoader;

  constructor(
    envVar: string = 'AGENT_RBAC_CONFIG',
    ownerFallbackEnvVar?: string,
  ) {
    const configPath = process.env[envVar];
    if (!configPath) {
      throw new Error(
        `Environment variable ${envVar} is not set. Cannot locate config file.`,
      );
    }
    this.delegate = new FileConfigLoader(configPath, ownerFallbackEnvVar);
  }

  load(): PermissionConfig {
    return this.delegate.load();
  }

  save(config: PermissionConfig): void {
    this.delegate.save(config);
  }
}
