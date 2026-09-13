/**
 * Write-then-rename, in one place.
 *
 * Every piece of state this app writes is a small JSON file that another
 * process might read at any moment (the UI polls status.json while the worker
 * rewrites it). A half-written file is a crash waiting to happen, so writes go
 * to a unique temp name and are renamed into place, which is atomic on POSIX.
 *
 * The temp name includes the pid, a clock reading and a counter: a fixed
 * `.tmp` name lets a throttled progress write and a forced write interleave
 * their renames.
 */

import fs from 'node:fs';
import path from 'node:path';

let counter = 0;

function tempPath(file: string): string {
  counter += 1;
  return `${file}.${process.pid}.${Date.now().toString(36)}.${counter}.tmp`;
}

export function writeTextAtomic(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = tempPath(file);
  try {
    fs.writeFileSync(temp, contents);
    fs.renameSync(temp, file);
  } catch (error) {
    // Do not leave a stray temp file behind if the rename never happened.
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // The original error is the useful one.
    }
    throw error;
  }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function pathExists(file: string): boolean {
  try {
    fs.statSync(file);
    return true;
  } catch {
    return false;
  }
}
