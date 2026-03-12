/**
 * Memory store implementations.
 *
 * FileSystemMemoryStore: file-based storage with path structure {basePath}/{userId}/{key}.md
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MemoryStore } from '../types.js';

export class FileSystemMemoryStore implements MemoryStore {
  constructor(private readonly basePath: string) {}

  async read(userId: string, key: string): Promise<string | null> {
    const filePath = this.getPath(userId, key);
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  async write(userId: string, key: string, content: string): Promise<void> {
    const filePath = this.getPath(userId, key);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  async delete(userId: string, key: string): Promise<boolean> {
    const filePath = this.getPath(userId, key);
    try {
      fs.unlinkSync(filePath);
      this.pruneEmptyDirectories(path.dirname(filePath));
      return true;
    } catch {
      return false;
    }
  }

  async list(userId: string): Promise<string[]> {
    const userDir = path.join(this.basePath, this.sanitizeSegment(userId));
    try {
      return this.walkKeys(userDir);
    } catch {
      return [];
    }
  }

  async exists(userId: string, key: string): Promise<boolean> {
    return fs.existsSync(this.getPath(userId, key));
  }

  private getPath(userId: string, key: string): string {
    const safeUser = this.sanitizeSegment(userId);
    const safeSegments = this.sanitizeKey(key);
    const fileSegments = [...safeSegments];
    const last = fileSegments.pop() ?? 'index';
    return path.join(this.basePath, safeUser, ...fileSegments, `${last}.md`);
  }

  /**
   * Sanitize path components to prevent directory traversal.
   */
  private sanitizeSegment(segment: string): string {
    return segment.replace(/[^a-zA-Z0-9_\-]/g, '_');
  }

  private sanitizeKey(key: string): string[] {
    const segments = key
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
      .map((segment) => this.sanitizeSegment(segment));
    return segments.length > 0 ? segments : ['index'];
  }

  private walkKeys(dir: string, prefix: string = ''): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const results: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        results.push(
          ...this.walkKeys(
            path.join(dir, entry.name),
            prefix ? `${prefix}/${entry.name}` : entry.name,
          ),
        );
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const key = entry.name.replace(/\.md$/, '');
      results.push(prefix ? `${prefix}/${key}` : key);
    }

    return results;
  }

  private pruneEmptyDirectories(startDir: string): void {
    let current = startDir;
    const root = path.resolve(this.basePath);
    while (current.startsWith(root) && current !== root) {
      if (fs.readdirSync(current).length > 0) break;
      fs.rmdirSync(current);
      current = path.dirname(current);
    }
  }
}
