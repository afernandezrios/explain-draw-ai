/**
 * The render half: the real worker, the real renderer, real ffmpeg.
 *
 * Renders are the slow part, so the storyboards here are the cheapest ones the
 * format allows: 39 x 7s (273s, just inside the window) for a render that has
 * to happen, and the 3 x 10s sample for the refusals. 273s is not a choice --
 * the budget gate is part of the product (a ~5 minute video, refused outside
 * 270-330s), so a render the worker will accept is at least 6480 frames. The
 * 30s sample can never pass that gate, and there is a test below pinning the
 * refusal.
 *
 * FakeLLM is not used here: none of this needs a model.
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fakeScenes } from '../../src/lib/fixtures.ts';
import { readStatus, sceneClipPath } from '../../src/lib/pipeline.ts';
import { CANVAS_HEIGHT, CANVAS_WIDTH, FPS, LOCK_FILENAME, sceneClipName } from '../../src/lib/render-config.ts';
import { activeJob, cancelJob, startJob } from '../../src/lib/render-jobs.ts';
import { claimLock } from '../../src/lib/render-lock.ts';
import { DRAW_LEAD_IN_RATIO, DRAW_LEAD_OUT_RATIO, drawWindows } from '../../src/lib/timeline.ts';
import {
  FULL_RENDER_FRAMES,
  IMPOSSIBLE_PID,
  ffprobe,
  frameCount,
  fullStoryboard,
  makeProject,
  readLockFile,
  releaseLock,
  runWorker,
  spawnWorker,
  useTempProjectsRoot,
  waitForExit,
  waitForStatus,
  writeLock,
} from './helpers.ts';

let root = '';

beforeAll(() => {
  root = useTempProjectsRoot();
});

// Every test here either waits for its worker to finish or deliberately writes
// a lock of its own, so clearing one left by a failed test keeps a stale refusal
// from failing the next one for the wrong reason.
beforeEach(() => {
  releaseLock();
});

afterAll(() => {
  releaseLock();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('a full render', () => {
  it('draws every scene, joins them, and leaves a playable out.mp4', async () => {
    const project = makeProject(fullStoryboard(), { input: 'full render' });

    const result = await runWorker(project);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Render complete.');

    // The file a browser receives, not a metadata claim about it.
    const out = path.join(project.dir, 'out.mp4');
    const info = await ffprobe(out);
    expect(info.codec).toBe('h264');
    expect(info.width).toBe(CANVAS_WIDTH);
    expect(info.height).toBe(CANVAS_HEIGHT);
    expect(info.fps).toBe(FPS);
    expect(info.durationSeconds).toBeCloseTo(273, 1);
    expect(await frameCount(out)).toBe(FULL_RENDER_FRAMES);

    // Every scene contributed a clip, and the join cleaned up after itself.
    const clips = fs.readdirSync(path.join(project.dir, 'clips'));
    expect(clips.sort()).toEqual(
      Array.from({ length: 39 }, (_, index) => sceneClipName(index)).sort(),
    );
    expect(clips.some((name) => name.endsWith('.tmp.mp4'))).toBe(false);
    expect(fs.existsSync(path.join(project.dir, 'concat.txt'))).toBe(false);

    const status = readStatus(project.id);
    expect(status?.state).toBe('done');
    expect(status?.progress).toBe(1);
    expect(status?.renderedScenes).toBe(39);
    expect(status?.totalScenes).toBe(39);
    expect(activeJob()).toBeNull();
  }, 900_000);

  it('refuses the 30s sample, under the minimum the product promises', async () => {
    // `fakeScenes()` is 3 x 10s: the sample the spec's task list wants rendered
    // whole. The budget gate is the older, frozen rule and it wins, so this is
    // the documented reason the full-render test above uses 39 x 7s instead.
    const project = makeProject(fakeScenes(), { input: 'sample' });

    const result = await runWorker(project);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('refusing to render');
    expect(result.stderr).toContain('under the 4:30 minimum');
    expect(fs.existsSync(path.join(project.dir, 'out.mp4'))).toBe(false);
    // Refused before any work: no browser, no clips, no lock left behind.
    expect(fs.readdirSync(path.join(project.dir, 'clips'))).toEqual([]);
    expect(readLockFile()).toBeNull();
  }, 120_000);
});

describe('cancelling', () => {
  it('stops through startJob/cancelJob, releases the lock and keeps finished clips', async () => {
    const project = makeProject(fullStoryboard(), { input: 'cancel' });

    const started = startJob({ projectId: project.id });
    expect(started.ok).toBe(true);

    // Wait for the worker's own status to move past the first scene. Waiting on
    // the clip file instead would race the encoder still writing it.
    const pastFirstScene = await waitForStatus(
      project.id,
      (status) => status.renderedScenes >= 1,
      'the first scene to finish',
    );
    expect(pastFirstScene.totalScenes).toBe(39);

    expect(cancelJob(project.id)).toBe(true);

    const cancelled = await waitForStatus(
      project.id,
      (status) => status.state === 'cancelled',
      'the job to report itself cancelled',
    );
    expect(cancelled.finishedAt).not.toBeNull();

    // The lock is the app's only cross-project state; a cancel that left it
    // behind would wedge every later render.
    expect(activeJob()).toBeNull();

    // AC5: the clips already finished stay on disk, and there is no video.
    const firstClip = sceneClipPath(project.id, 0);
    expect(fs.existsSync(firstClip)).toBe(true);
    expect(fs.statSync(firstClip).size).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(project.dir, 'out.mp4'))).toBe(false);
  }, 300_000);

  it('exits 130, so a cancelled render is not confused with a successful one', async () => {
    const project = makeProject(fullStoryboard(), { input: 'exit code' });

    const { child, output } = spawnWorker(project);
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ code, signal }));
    });

    await waitForStatus(
      project.id,
      (status) => status.renderedScenes >= 1,
      'the first scene to finish',
    );
    child.kill('SIGTERM');

    const { code } = await exited;
    expect(code).toBe(130);
    expect(output().stdout).toContain('cancelled');
  }, 300_000);

  it('marks the job failed when the worker dies without reporting anything', async () => {
    const project = makeProject(fullStoryboard(), { input: 'crash' });

    const started = startJob({ projectId: project.id });
    expect(started.ok).toBe(true);

    const lock = activeJob();
    if (!lock) {
      throw new Error('expected a held render lock');
    }
    process.kill(lock.pid, 'SIGKILL');

    const failed = await waitForStatus(
      project.id,
      (status) => status.state === 'failed',
      'the job to be marked failed',
    );
    expect(failed.message).toContain('exited unexpectedly');
    expect(activeJob()).toBeNull();
  }, 300_000);
});

describe('one render at a time', () => {
  it('refuses a second render while one is live', async () => {
    const project = makeProject(fullStoryboard(), { input: 'busy' });

    const first = startJob({ projectId: project.id });
    expect(first.ok).toBe(true);

    const second = startJob({ projectId: project.id });
    expect(second).toEqual({ ok: false, reason: 'busy', activeProjectId: project.id });

    expect(cancelJob(project.id)).toBe(true);
    await waitForStatus(project.id, (status) => status.state === 'cancelled', 'the job to stop');
  }, 300_000);

  it('does not cancel a job that belongs to another project', async () => {
    const busy = makeProject(fullStoryboard(), { input: 'busy project' });
    const other = makeProject(fullStoryboard(), { input: 'other project' });

    expect(startJob({ projectId: busy.id }).ok).toBe(true);
    // The Cancel button carries an id, and must not stop somebody else's render.
    expect(cancelJob(other.id)).toBe(false);
    expect(activeJob()?.projectId).toBe(busy.id);

    expect(cancelJob(busy.id)).toBe(true);
    await waitForStatus(busy.id, (status) => status.state === 'cancelled', 'the job to stop');
  }, 300_000);

  it('starts again once a dead worker leaves its lock behind', async () => {
    const project = makeProject(fullStoryboard(), { input: 'stale lock' });
    writeLock(project.id, IMPOSSIBLE_PID);

    // Reclaiming on sight is what stops a crashed render from wedging the app.
    expect(activeJob()).toBeNull();

    const started = startJob({ projectId: project.id });
    expect(started.ok).toBe(true);

    expect(cancelJob(project.id)).toBe(true);
    await waitForStatus(project.id, (status) => status.state === 'cancelled', 'the job to stop');
  }, 300_000);
});

describe('the worker and the render lock', () => {
  // These use the window-passing storyboard: the budget gate runs before the
  // lock is claimed, so a one-scene storyboard would be refused on its length
  // and never reach the lock decision under test.

  it('refuses to start while another live render holds the lock', async () => {
    const project = makeProject(fullStoryboard(), { input: 'held lock' });
    // A live lock, as an app render would leave behind. `process.pid` is alive
    // and is never signalled by anything in this test.
    writeLock(project.id, process.pid);

    const result = await runWorker(project);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('another render is already running');
    expect(fs.existsSync(path.join(project.dir, 'out.mp4'))).toBe(false);

    // The lock it declined to take is left exactly as it was: the worker must
    // not "helpfully" clear somebody else's job.
    expect(readLockFile()?.pid).toBe(process.pid);
  }, 120_000);

  it('claims the lock for its own pid and releases it on the way out', async () => {
    const project = makeProject(fullStoryboard(), { input: 'worker claims' });

    const { child, output } = spawnWorker(project);
    // The worker writes its status after claiming, so a visible status means
    // the lock is already held.
    await waitForStatus(project.id, (status) => status.state === 'running', 'the worker to start');
    const held = readLockFile();
    expect(held?.pid).toBe(child.pid);
    expect(held?.projectId).toBe(project.id);

    // Stopped rather than run to completion: this test is about the lock, and a
    // full render would cost fifteen minutes to say the same thing.
    child.kill('SIGTERM');
    const { code } = await waitForExit(child);
    expect(code).toBe(130);
    expect(output().stderr).not.toContain('another render');
    expect(fs.existsSync(path.join(project.dir, 'out.mp4'))).toBe(false);
    // Released without the app's help: `npm run render` by hand must not wedge
    // the UI's next render either.
    expect(readLockFile()).toBeNull();
  }, 120_000);

  it('takes over a lock left behind by a worker that died', async () => {
    const project = makeProject(fullStoryboard(), { input: 'stale lock worker' });
    writeLock(project.id, IMPOSSIBLE_PID);

    const { child, output } = spawnWorker(project);
    // A visible status means the stale lock was reclaimed and this worker holds
    // the new one.
    await waitForStatus(project.id, (status) => status.state === 'running', 'the worker to start');
    child.kill('SIGTERM');
    const { code } = await waitForExit(child);
    expect(code).toBe(130);
    expect(output().stderr).not.toContain('another render');
    expect(fs.existsSync(path.join(project.dir, 'out.mp4'))).toBe(false);
    expect(readLockFile()).toBeNull();
  }, 120_000);

  it('throws rather than reporting a busy app when the lock cannot be written at all', () => {
    // The parent of the lock path is a regular file, so the exclusive create
    // has nowhere to land. "Held" would be a lie the caller acts on -- the UI
    // would show another project's render and never start this one -- and it is
    // also the one case where the spawned worker must be stopped instead of
    // being left running with no lock guarding it.
    const notADirectory = path.join(root, 'not-a-directory');
    fs.writeFileSync(notADirectory, 'x');
    try {
      expect(() =>
        claimLock(path.join(notADirectory, LOCK_FILENAME), {
          projectId: 'anything',
          projectDir: path.join(notADirectory, 'anything'),
          pid: process.pid,
          startedAt: Date.now(),
        }),
      ).toThrow();
    } finally {
      fs.rmSync(notADirectory, { force: true });
    }
  });
});

describe('the handwriting face', () => {
  it('is loaded by the composition the worker bundles, not merely mentioned', () => {
    // A source check, deliberately: a finished MP4 records the family name, not
    // which module fetched the face, so no assertion on the file could tell a
    // real load from a fallback. What can be pinned is the wiring -- the bundle
    // entry has to import the loader for its side effect, and the loader has to
    // hold the render open and fail it loudly if the fetch fails.
    const entry = fs.readFileSync(path.join(process.cwd(), 'src', 'remotion', 'index.ts'), 'utf8');
    expect(entry).toMatch(/^import ['"]\.\/fonts\.ts['"];$/m);

    const loader = fs.readFileSync(path.join(process.cwd(), 'src', 'remotion', 'fonts.ts'), 'utf8');
    expect(loader).toContain('loadFont(');
    expect(loader).toContain('delayRender(');
    expect(loader).toContain('cancelRender(');
  });
});

describe('the draw timeline', () => {
  it('gives every shape a window that starts and ends inside the scene', () => {
    for (const durationInFrames of [24, 168, 240, 480, 720]) {
      for (const shapeCount of [3, 4, 8, 12]) {
        const windows = drawWindows(shapeCount, durationInFrames);
        expect(windows).toHaveLength(shapeCount);

        for (const window of windows) {
          expect(window.start).toBeGreaterThanOrEqual(0);
          expect(window.end).toBeGreaterThan(window.start);
          expect(window.end).toBeLessThanOrEqual(durationInFrames);
        }
        for (let i = 1; i < windows.length; i++) {
          // Drawn in array order, so a shape never starts before the one before
          // it, and never overlaps it in a way that reads as simultaneous.
          expect(windows[i].start).toBeGreaterThanOrEqual(windows[i - 1].start);
          expect(windows[i].end).toBeGreaterThanOrEqual(windows[i - 1].end);
        }

        // The board is blank for the lead-in, and fully drawn for the lead-out.
        expect(windows[0].start).toBe(Math.round(durationInFrames * DRAW_LEAD_IN_RATIO));
        expect(windows[shapeCount - 1].end).toBe(
          durationInFrames - Math.round(durationInFrames * DRAW_LEAD_OUT_RATIO),
        );
      }
    }

    expect(drawWindows(0, 240)).toEqual([]);
  });
});

describe('the worker refuses what it cannot honour', () => {
  it('reports a missing storyboard rather than writing an empty video', async () => {
    const project = makeProject(fakeScenes(), { input: 'no scenes' });
    fs.rmSync(path.join(project.dir, 'scenes.json'));

    const result = await runWorker(project);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('refusing to render');
    expect(fs.existsSync(path.join(project.dir, 'out.mp4'))).toBe(false);
  }, 120_000);
});

describe('project folders', () => {
  it('keeps every project self-contained', () => {
    const project = makeProject(fakeScenes(), { input: 'layout' });
    const entries = fs.readdirSync(project.dir).sort();
    expect(entries).toContain('input.txt');
    expect(entries).toContain('script.json');
    expect(entries).toContain('scenes.json');
    expect(entries).toContain('clips');
  });
});
