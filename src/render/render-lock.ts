/**
 * The render lock: "exactly one render at a time", across processes.
 *
 * The lock is a file, not module state, because every Next route handler gets
 * its own module graph -- an in-memory "current job" variable is simply not
 * shared, and the render route and the cancel route would disagree about
 * whether anything is running. The CLI worker is a third process that has to
 * agree too.
 *
 * That is why these primitives live in a leaf module: both the server
 * (`render-jobs.ts`) and the render worker import them, and a worker that
 * dragged the Next app's module graph (and the OpenAI SDK) in with them would
 * pay for a render it is not doing. Everything here is `fs` and plain types.
 *
 * A lock records the *worker's* process id, so:
 *   - cancel can signal the worker without an in-process handle, and
 *   - a worker that died without cleaning up (SIGKILL, crash, reboot) is
 *     detected by testing the pid, and its lock is reclaimed instead of
 *     wedging every future render.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readJsonFile } from '../lib/atomic.ts';
import { LOCK_FILENAME } from './render-config.ts';

export type RenderLock = {
  projectId: string;
  projectDir: string;
  /** The render worker, not the server process that spawned it. */
  pid: number;
  startedAt: number;
};

/** Every field is checked: a hand-edited lock must not pass as a live job. */
export function isRenderLock(value: unknown): value is RenderLock {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<RenderLock>;
  return (
    typeof candidate.projectId === 'string' &&
    typeof candidate.projectDir === 'string' &&
    typeof candidate.pid === 'number' &&
    typeof candidate.startedAt === 'number'
  );
}

/** The lock for a projects root. It sits beside the project folders. */
export function lockFilePath(projectsRoot: string): string {
  return path.join(projectsRoot, LOCK_FILENAME);
}

export function readLock(file: string): RenderLock | null {
  const raw = readJsonFile<unknown>(file);
  return isRenderLock(raw) ? raw : null;
}

/** Is this pid a live process? Not exported: it is the lock's own business. */
function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // A live process we may not signal still counts as alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Removes the lock, but only while it is still the one we are thinking of.
 * Comparing pids rather than project ids matters when two jobs for the same
 * project overlap: the loser must not delete the winner's lock.
 */
export function releaseLockIfOwnedBy(file: string, pid: number): void {
  const lock = readLock(file);
  if (lock && lock.pid === pid) {
    fs.rmSync(file, { force: true });
  }
}

export type ClaimOutcome =
  /** The lock did not exist and is now ours. */
  | 'claimed'
  /** A lock carrying our own pid was already there. */
  | 'mine'
  /** Someone else's live lock is in the way. */
  | 'held';

/** Writes the lock over whatever is there, atomically, via a temp file of ours. */
function replaceLockFile(file: string, body: string): void {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, body);
    fs.renameSync(temp, file);
  } finally {
    // A no-op once the rename has moved it.
    fs.rmSync(temp, { force: true });
  }
}

/**
 * Claims the lock with an exclusive create.
 *
 * `mine` is what makes spawn-then-claim work: the app spawns the worker and
 * writes the lock with the worker's pid straight away, so either writer may
 * arrive first and both call the result a success. A lock whose owner is gone
 * is cleared first, so a crashed render cannot wedge the next one.
 *
 * Clearing a dead lock is a *replace*, never a delete: with delete-then-create
 * there is a window where the file is simply absent, and two processes that both
 * saw the same dead lock both create it and both call themselves the owner. An
 * atomic rename leaves the path holding somebody's lock throughout.
 *
 * Either way the write is only half of the claim, and the second half is
 * reading the file back: a rename can be renamed over by a second reclaimer
 * immediately afterwards, and a claim that is no longer in the file is not a
 * claim. Whoever reads back somebody else's pid stands down as `held`.
 *
 * A write that fails for any other reason throws: a claim that neither
 * succeeded nor found a holder must never be mistaken for a busy app.
 */
export function claimLock(file: string, lock: RenderLock): ClaimOutcome {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = `${JSON.stringify(lock, null, 2)}\n`;

  const existing = readLock(file);
  if (existing) {
    if (existing.pid === lock.pid) {
      return 'mine';
    }
    if (pidAlive(existing.pid)) {
      return 'held';
    }
    // The owner is gone; take the lock over.
    replaceLockFile(file, body);
  } else {
    try {
      fs.writeFileSync(file, body, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        // Somebody else created it between our read and our write. An exclusive
        // create cannot be won twice, so this one is genuinely theirs.
        return 'held';
      }
      throw error;
    }
  }

  const written = readLock(file);
  return written !== null && written.pid === lock.pid ? 'claimed' : 'held';
}

/**
 * The live job, if any. A lock whose worker is gone is reclaimed on sight,
 * otherwise a killed render would block every later one.
 */
export function activeJob(file: string): RenderLock | null {
  const lock = readLock(file);
  if (!lock) {
    return null;
  }
  if (pidAlive(lock.pid)) {
    return lock;
  }
  releaseLockIfOwnedBy(file, lock.pid);
  return null;
}
