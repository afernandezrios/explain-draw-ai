/**
 * Starting, watching and cancelling the one render job.
 *
 * The lock itself lives in `render-lock.ts` because the worker claims the same
 * lock; this module is the server's side of it -- spawn the worker, claim with
 * its pid, keep the UI's view of the job alive, and let cancel reach it.
 *
 * Spawn-then-claim is deliberate: the lock must always carry a real worker pid,
 * and claiming before the spawn would mean writing a pid that might never
 * exist. The worker accepts a lock carrying its own pid as its own, so the
 * order the two writers happen to arrive in does not matter.
 */

import { readJsonFile, writeJsonAtomic } from './atomic.ts';
import { projectFiles, projectsRoot, readScenes, scenesToVideo } from './pipeline.ts';
import {
  activeJob as activeJobAt,
  claimLock,
  lockFilePath,
  readLock,
  releaseLockIfOwnedBy,
  type ClaimOutcome,
  type RenderLock,
} from './render-lock.ts';
import { type JobState, type RenderStatus, isTerminal } from './render-status.ts';

export type { RenderLock };

export type StartJobOptions = {
  projectId: string;
};

export type StartJobResult =
  | { ok: true; pid: number }
  | { ok: false; reason: 'busy'; activeProjectId: string }
  /** The lock could not be written, so the job was stopped rather than left unguarded. */
  | { ok: false; reason: 'lock-error'; message: string };

function lockFile(): string {
  return lockFilePath(projectsRoot());
}

/** The live job, if any. A lock whose worker is gone is reclaimed on sight. */
export function activeJob(): RenderLock | null {
  return activeJobAt(lockFile());
}

function writeStatus(projectId: string, status: RenderStatus): void {
  writeJsonAtomic(projectFiles(projectId).status, status);
}

/**
 * Records that the job failed (or was cancelled) when the worker could not.
 *
 * Only ever speaks for the worker it was created for. A worker's exit can land
 * long after a *newer* job has claimed the lock and started writing its own
 * status; without this check that late exit would stamp `failed` over a render
 * that is running perfectly well.
 */
function failJob(projectId: string, workerPid: number, message: string, state: JobState): void {
  const files = projectFiles(projectId);
  const current = readJsonFile<Partial<RenderStatus>>(files.status);
  if (current && typeof current.pid === 'number' && current.pid !== 0 && current.pid !== workerPid) {
    return;
  }

  try {
    writeFailure(projectId, current, message, state);
  } catch (error) {
    // Reached from an exit handler and from the lock-error path, neither of
    // which can do anything with a throw -- and the reason the status is
    // unwritable is usually the same thing that failed the job. Losing the
    // record is bad; taking the server down with it is worse.
    process.stderr.write(
      `[render] could not record the outcome for ${projectId}: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
  }
}

/** The write itself, separated so `failJob` can survive it failing. */
function writeFailure(
  projectId: string,
  current: Partial<RenderStatus> | null,
  message: string,
  state: JobState,
): void {
  writeStatus(projectId, {
    state,
    pid: 0,
    startedAt: current?.startedAt ?? Date.now(),
    updatedAt: Date.now(),
    finishedAt: Date.now(),
    sceneIndex: current?.sceneIndex ?? 0,
    totalScenes: current?.totalScenes ?? 0,
    renderedScenes: current?.renderedScenes ?? 0,
    progress: current?.progress ?? 0,
    message,
  });
}

/** Stops a worker we started but cannot legitimately keep running. */
function abandonWorker(pid: number): void {
  // `child.pid` is undefined when the spawn failed outright, and the handle
  // falls back to 0. `process.kill(0, ...)` signals every process in this
  // server's process group -- the whole dev server, and any sibling render.
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}

/**
 * Starts a render, or refuses because one is already running.
 */
export function startJob(options: StartJobOptions): StartJobResult {
  const running = activeJob();
  if (running) {
    return { ok: false, reason: 'busy', activeProjectId: running.projectId };
  }

  const { projectId } = options;
  const files = projectFiles(projectId);
  const startedAt = Date.now();

  // Assigned synchronously by the spawn below, before any event can fire.
  let workerPid = 0;

  const handles = scenesToVideo({
    projectId,
    statusPath: files.status,
    onExit: (code, signal) => {
      releaseLockIfOwnedBy(lockFile(), workerPid);

      const current = readJsonFile<Partial<RenderStatus>>(files.status);
      const ownsStatus = !current || current.pid === undefined || current.pid === 0 || current.pid === workerPid;
      if (!ownsStatus || isTerminal(current?.state)) {
        // Either a newer job owns status.json now, or the worker reported its own
        // outcome before exiting. Nothing left for us to record.
        return;
      }

      const tail = handles.logTail().slice(-6).join(' | ');
      const cancelled = code === 130 || signal === 'SIGTERM';
      failJob(
        projectId,
        workerPid,
        cancelled
          ? 'Render cancelled.'
          : `The render worker exited unexpectedly (${code ?? signal ?? 'no exit code'}).${tail ? ` Last output: ${tail}` : ''}`,
        cancelled ? 'cancelled' : 'failed',
      );
    },
    onError: (error) => {
      releaseLockIfOwnedBy(lockFile(), workerPid);
      failJob(projectId, workerPid, `Could not start the render worker: ${error.message}`, 'failed');
    },
  });
  workerPid = handles.child.pid ?? 0;

  let outcome: ClaimOutcome;
  try {
    outcome = claimLock(lockFile(), {
      projectId,
      projectDir: files.dir,
      pid: workerPid,
      startedAt,
    });
  } catch (error) {
    // The lock could not be written at all, so the worker we just spawned is
    // invisible to cancel and to the single-job rule. Stop it and say so.
    abandonWorker(workerPid);
    const message = error instanceof Error ? error.message : String(error);
    failJob(projectId, workerPid, `Could not claim the render lock: ${message}`, 'failed');
    return { ok: false, reason: 'lock-error', message };
  }

  if (outcome === 'held') {
    // Someone else won the race; stop the worker we started and stand down.
    abandonWorker(workerPid);
    const winner = readLock(lockFile());
    return { ok: false, reason: 'busy', activeProjectId: winner?.projectId ?? projectId };
  }

  // Claim the UI's view of the job immediately, so a previous job's terminal
  // status cannot flash while the worker boots.
  const stored = readScenes(projectId);
  const totalScenes = stored.ok ? stored.scenes.length : 0;
  writeStatus(projectId, {
    state: 'running',
    pid: workerPid,
    startedAt,
    updatedAt: startedAt,
    finishedAt: null,
    sceneIndex: 0,
    totalScenes,
    renderedScenes: 0,
    progress: 0,
    message: 'Starting the render...',
  });

  return { ok: true, pid: workerPid };
}

/**
 * Cancels the job for this project, and only this project. Returns false when
 * no job matches, so a stale "Cancel" click cannot stop somebody else's render.
 */
export function cancelJob(projectId: string): boolean {
  const lock = activeJob();
  if (!lock || lock.projectId !== projectId) {
    return false;
  }
  try {
    process.kill(lock.pid, 'SIGTERM');
    return true;
  } catch (error) {
    // ESRCH: the worker died between the liveness check and the signal, so the
    // lock is stale and releasing it is safe. Anything else -- EPERM above all
    // -- means the process is alive but not ours to signal, and deleting its
    // lock would start a second render on top of a live one.
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      releaseLockIfOwnedBy(lockFile(), lock.pid);
    }
    return false;
  }
}
