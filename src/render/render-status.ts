/**
 * The status.json contract.
 *
 * The worker writes it, the API routes and the UI read it. It is the single
 * source of truth for "what is happening right now", which matters because the
 * worker is a separate process: if it is killed outright, status.json is all
 * that is left behind.
 *
 * Deliberately free of `fs` so the browser bundle can import the types -- and
 * so the worker, the routes and the page all agree on the shape by importing
 * this module rather than retyping it.
 */

export type JobState = 'running' | 'done' | 'failed' | 'cancelled';

export const JOB_STATES: readonly JobState[] = ['running', 'done', 'failed', 'cancelled'];

export type RenderStatus = {
  state: JobState;
  /**
   * Process id of the worker, for the UI to reason about a worker that died --
   * and for the server to tell one job's status from a newer job's. Zero means
   * "no live worker wrote this".
   */
  pid: number;
  /** When the job started; the UI uses it to ignore a previous job's outcome. */
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  /** Scene currently being drawn, 0-based. */
  sceneIndex: number;
  totalScenes: number;
  /** Scenes finished so far. */
  renderedScenes: number;
  /** 0..1 across the whole job. */
  progress: number;
  message: string | null;
};

/** Takes `unknown` so callers can ask the question of a value they have not validated yet. */
export function isTerminal(state: unknown): boolean {
  return JOB_STATES.includes(state as JobState) && state !== 'running';
}

/**
 * Every field is checked, not just "looks like a status".
 *
 * A partially-valid status is worse than none: a missing `state` used to read
 * as "not terminal" (so the UI polled a dead job forever) and a missing
 * `updatedAt` turned the staleness comparison into NaN (so the fallback that
 * recovers from a killed worker never fired).
 */
export function isRenderStatus(value: unknown): value is RenderStatus {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<RenderStatus>;
  return (
    JOB_STATES.includes(candidate.state as JobState) &&
    typeof candidate.pid === 'number' &&
    typeof candidate.startedAt === 'number' &&
    typeof candidate.updatedAt === 'number' &&
    (candidate.finishedAt === null || typeof candidate.finishedAt === 'number') &&
    typeof candidate.sceneIndex === 'number' &&
    typeof candidate.totalScenes === 'number' &&
    typeof candidate.renderedScenes === 'number' &&
    typeof candidate.progress === 'number' &&
    (candidate.message === null || typeof candidate.message === 'string')
  );
}
