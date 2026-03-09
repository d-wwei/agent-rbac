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
      return true;
    } catch {
      return false;
    }
  }

  async list(userId: string): Promise<string[]> {
    const userDir = path.join(this.basePath, this.sanitize(userId));
    try {
      const entries = fs.readdirSync(userDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name.replace(/\.md$/, ''));
    } catch {
      return [];
    }
  }

  async exists(userId: string, key: string): Promise<boolean> {
    return fs.existsSync(this.getPath(userId, key));
  }

  private getPath(userId: string, key: string): string {
    return path.join(
      this.basePath,
      this.sanitize(userId),
      `${this.sanitize(key)}.md`,
    );
  }

  /**
   * Sanitize path components to prevent directory traversal.
   */
  private sanitize(segment: string): string {
    return segment.replace(/[^a-zA-Z0-9_\-]/g, '_');
  }
}
