#!/usr/bin/env node
/**
 * The render worker.
 *
 * A separate process on purpose. Bundling and encoding inside a route handler
 * would block the whole server and leave nothing to cancel, so the API route
 * spawns this and the UI polls the status file it writes. Running it by hand
 * from the command line goes through exactly the same code.
 *
 * It is also the last line of defence for the three things a render must always
 * honour, whichever way it was started:
 *
 *   - the storyboard is re-validated against the DSL, and a full render whose
 *     total falls outside the accepted window is refused, using the same schema
 *     and the same constants as the app;
 *   - the render lock is claimed before any work starts, so a CLI render cannot
 *     run alongside an app render (two Chromium renders on a 7.6 GiB laptop, and
 *     no way to cancel the one the UI cannot see);
 *   - every finished file is rendered to a temp name and renamed into place, so
 *     a cancelled or failed render never leaves a half-written MP4 where the
 *     player (or the next run) would find it.
 *
 * Exit codes: 0 success, 1 refusal/failure, 130 cancelled.
 *
 * Run directly with: node scripts/render-worker.ts --project <dir> [--scene n]
 * (Node runs TypeScript here via type stripping, which is why the shared schema,
 * lock and constants are imported as real .ts modules rather than duplicated.)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import {
  ensureBrowser,
  makeCancelSignal,
  renderMedia,
  selectComposition,
} from '@remotion/renderer';
import { readJsonFile, writeJsonAtomic } from '../src/lib/atomic.ts';
import {
  CLIPS_DIRNAME,
  CRF,
  IMAGE_FORMAT,
  LOCK_FILENAME,
  MAX_FRAME_CONCURRENCY,
  OUTPUT_FILENAME,
  PIXEL_FORMAT,
  PREVIEW_CLIP_FILENAME,
  PREVIEW_FILENAME,
  SCENES_FILENAME,
  STATUS_FILENAME,
  VIDEO_CODEC,
  X264_PRESET,
  sceneClipName,
} from '../src/lib/render-config.ts';
import { claimLock, releaseLockIfOwnedBy, type RenderLock } from '../src/lib/render-lock.ts';
import type { RenderMode, RenderStatus } from '../src/lib/render-status.ts';
import { checkBudget, validateScenes, type Scene } from '../src/lib/schema.ts';

const WORKER_DIR = import.meta.dirname;
const PROJECT_ROOT = path.resolve(WORKER_DIR, '..');
const ENTRY_POINT = path.join(PROJECT_ROOT, 'src', 'remotion', 'index.ts');

const COMPOSITION_ID = 'Scene';
const STATUS_THROTTLE_MS = 200;
const EXIT_FAILED = 1;
const EXIT_CANCELLED = 130;

/* ───────────────────────────── arguments ────────────────────────── */

class UsageError extends Error {}
class CancelledError extends Error {}

type WorkerArgs = {
  projectDir: string;
  statusPath: string;
  /** Scene to render for a preview; absent means render the whole video. */
  scene?: number;
};

const USAGE = `Usage: node scripts/render-worker.ts --project <dir> [options]

  --project <dir>   project folder holding scenes.json (required)
  --status <file>   where to write render status (default <dir>/${STATUS_FILENAME})
  --scene <n>       render only scene n (0-based) as a preview
`;

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`${flag} needs a value`);
  }
  return value;
}

/** Rejects anything that is not a plain non-negative integer. */
function parseSceneArg(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new UsageError(`--scene must be a non-negative integer, got "${value}"`);
  }
  return Number.parseInt(value, 10);
}

function parseArgs(argv: string[]): WorkerArgs {
  let projectDir: string | undefined;
  let statusPath: string | undefined;
  let scene: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project') {
      projectDir = requireValue(argv, ++i, '--project');
    } else if (arg === '--status') {
      statusPath = requireValue(argv, ++i, '--status');
    } else if (arg === '--scene') {
      scene = parseSceneArg(requireValue(argv, ++i, '--scene'));
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else {
      throw new UsageError(`unexpected argument "${arg}"`);
    }
  }

  if (!projectDir) {
    throw new UsageError('--project <dir> is required');
  }
  return {
    projectDir: path.resolve(projectDir),
    statusPath: path.resolve(statusPath ?? path.join(projectDir, STATUS_FILENAME)),
    scene,
  };
}

/* ────────────────────────────── status ──────────────────────────── */

let status: RenderStatus;
let statusPath = '';
let lastStatusWrite = 0;

function initStatus(pathToStatus: string, mode: RenderMode, totalScenes: number): void {
  statusPath = pathToStatus;
  status = {
    state: 'running',
    mode,
    pid: process.pid,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: null,
    sceneIndex: 0,
    totalScenes,
    renderedScenes: 0,
    progress: 0,
    message: mode === 'preview' ? 'Drawing the scene preview...' : 'Preparing the render...',
  };
  writeStatus({}, true);
}

function writeStatus(patch: Partial<RenderStatus>, force = false): void {
  const now = Date.now();
  if (!force && now - lastStatusWrite < STATUS_THROTTLE_MS) {
    return;
  }
  lastStatusWrite = now;
  Object.assign(status, patch, { updatedAt: now });
  // Unique temp name + rename, so a throttled progress write can never
  // interleave with a forced one and leave a torn file behind.
  writeJsonAtomic(statusPath, status);
}

function finish(state: RenderStatus['state'], message: string): number {
  writeStatus({ state, message, finishedAt: Date.now(), progress: state === 'done' ? 1 : status.progress }, true);
  process.stdout.write(`[render] ${state}: ${message}\n`);
  return state === 'cancelled' ? EXIT_CANCELLED : state === 'done' ? 0 : EXIT_FAILED;
}

/* ───────────────────────────── cancel ───────────────────────────── */

const { cancelSignal, cancel } = makeCancelSignal();
let cancelled = false;
/** ffmpeg during the join, so a cancel does not have to wait for the whole concat. */
let ffmpegChild: ChildProcess | null = null;

function requestCancel(): void {
  cancelled = true;
  cancel();
  if (ffmpegChild) {
    try {
      ffmpegChild.kill('SIGTERM');
    } catch {
      // Already gone; the exit handler still runs.
    }
  }
}

process.on('SIGTERM', requestCancel);
process.on('SIGINT', requestCancel);

/**
 * Cancel has to be honoured during the slow, browser-free start-up too, not
 * just once the first renderMedia is listening -- otherwise a first-run browser
 * download looks like a hung cancel button.
 */
function abortIfCancelled(stage: string): void {
  if (cancelled) {
    throw new CancelledError(`cancelled during ${stage}`);
  }
}

/**
 * Did renderMedia stop because we cancelled it?
 *
 * `make-cancel-signal` keeps its `isUserCancelledRender` helper but the package
 * entry point does not re-export it, so this checks the two things that helper
 * checks: our own cancel flag, and the message renderMedia rejects with.
 */
function looksCancelled(error: unknown): boolean {
  return cancelled || (error instanceof Error && /got cancelled/i.test(error.message));
}

/* ───────────────────────────── helpers ──────────────────────────── */

function overallProgress(sceneIndex: number, sceneProgress: number, totalScenes: number): number {
  if (totalScenes <= 0) {
    return 0;
  }
  return Math.min(1, (sceneIndex + sceneProgress) / totalScenes);
}

let tempCounter = 0;

/**
 * The temp name a render target is written to before it is renamed into place.
 *
 * The final `.mp4` extension is kept: the encoder picks its container from it.
 * The pid and counter keep two renders in one process from colliding.
 */
function tempTarget(finalPath: string): string {
  tempCounter += 1;
  return `${finalPath}.${process.pid}.${tempCounter}.tmp.mp4`;
}

/**
 * Runs ffmpeg, keeping stderr for diagnostics, never leaving a pipe unread, and
 * letting cancel reach the child.
 */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    ffmpegChild = child;
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 8000) {
        stderr = stderr.slice(-8000);
      }
    });
    child.on('error', (error) => {
      ffmpegChild = null;
      reject(new Error(`ffmpeg could not start: ${error.message}`));
    });
    child.on('close', (code) => {
      ffmpegChild = null;
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-600).trim()}`));
      }
    });
  });
}

/**
 * Joins the scene clips. `-c copy` is only lossless because every clip was
 * rendered with identical codec, pixel format, frame rate and canvas settings.
 *
 * The join goes to a temp file and is renamed into place, so the concat list is
 * cleaned up either way, a cancelled join leaves no out.mp4, and a player that
 * is already reading the previous out.mp4 keeps a whole file.
 */
async function concatClips(clipFiles: string[], outPath: string): Promise<void> {
  const listPath = path.join(path.dirname(outPath), 'concat.txt');
  const tempOut = tempTarget(outPath);
  const body = clipFiles.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(listPath, `${body}\n`);

  try {
    writeStatus({ message: 'Joining the scenes...' }, true);
    await runFfmpeg([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      tempOut,
    ]);
    // A cancel can land while ffmpeg is finishing. Reporting that as a
    // successful render would be a lie the UI acts on, so the finished temp is
    // thrown away rather than renamed.
    if (cancelled) {
      throw new CancelledError('cancelled during the join');
    }
    fs.renameSync(tempOut, outPath);
  } finally {
    fs.rmSync(listPath, { force: true });
    fs.rmSync(tempOut, { force: true });
  }
}

/* ─────────────────────────────── main ───────────────────────────── */

async function renderScene(options: {
  serveUrl: string;
  scene: Scene;
  index: number;
  totalScenes: number;
  /** Scenes already finished when this one starts. A preview job has none. */
  completedScenes: number;
  outputPath: string;
  /** Maps this scene's own 0..1 progress onto the job's. */
  jobProgress: (sceneProgress: number) => number;
}): Promise<void> {
  const { serveUrl, scene, index, totalScenes, completedScenes, outputPath, jobProgress } = options;
  const inputProps = { scene, sceneIndex: index, totalScenes };
  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps,
    logLevel: 'error',
  });

  // The scene number is the storyboard's, the total is the job's: a preview of
  // scene 4 of a 39-scene storyboard is "scene 4", not "scene 4 of 1".
  writeStatus(
    {
      sceneIndex: index,
      message:
        totalScenes > 1
          ? `Drawing scene ${index + 1} of ${totalScenes}...`
          : `Drawing scene ${index + 1}...`,
    },
    true,
  );

  // Rendered to a temp name: a scene cut short by a cancel must not leave a
  // truncated clip where the finished ones live.
  const tempOutput = tempTarget(outputPath);
  try {
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      outputLocation: tempOutput,
      codec: VIDEO_CODEC,
      pixelFormat: PIXEL_FORMAT,
      crf: CRF,
      x264Preset: X264_PRESET,
      imageFormat: IMAGE_FORMAT,
      concurrency: MAX_FRAME_CONCURRENCY,
      muted: true,
      overwrite: true,
      logLevel: 'error',
      cancelSignal,
      onProgress: ({ progress: sceneProgress }) => {
        writeStatus({
          sceneIndex: index,
          // Counted in the job's own terms: a preview of scene 4 is still the
          // first (and only) scene of its job, not "three already done".
          renderedScenes: completedScenes,
          progress: jobProgress(sceneProgress),
        });
      },
    });
    fs.renameSync(tempOutput, outputPath);
  } catch (error) {
    if (looksCancelled(error)) {
      throw new CancelledError(`cancelled while rendering scene ${index + 1}`);
    }
    throw error;
  } finally {
    // No-op after a successful rename; the cleanup for a cancelled or failed one.
    fs.rmSync(tempOutput, { force: true });
  }
}

/**
 * Reads and checks the storyboard. Validation always applies; the duration
 * window applies to a full render, while a single-scene preview is allowed for
 * a storyboard that is still being brought inside the window.
 */
function loadScenes(args: WorkerArgs): Scene[] {
  const scenesPath = path.join(args.projectDir, SCENES_FILENAME);
  const raw = readJsonFile<unknown>(scenesPath);
  if (raw === null) {
    throw new Error(`refusing to render: ${scenesPath} is missing or is not valid JSON`);
  }

  const validation = validateScenes(raw);
  if (!validation.ok) {
    const details = validation.errors.slice(0, 8).join('\n  ');
    throw new Error(`refusing to render: scenes.json does not match the scene format\n  ${details}`);
  }
  const scenes = validation.scenes;

  if (scenes.length === 0) {
    throw new Error('refusing to render: scenes.json holds no scenes');
  }

  if (args.scene !== undefined && (args.scene < 0 || args.scene >= scenes.length)) {
    throw new Error(
      `refusing to render: --scene ${args.scene} is outside scenes.json (0-${scenes.length - 1})`,
    );
  }

  if (args.scene === undefined) {
    const budget = checkBudget(scenes);
    if (!budget.ok) {
      throw new Error(`refusing to render: ${budget.message}`);
    }
  }

  return scenes;
}

/**
 * Takes the render lock, or explains why not.
 *
 * The lock sits beside the project folders, which is where the app keeps it:
 * `<PROJECTS_ROOT>/<id>` is the project, so its parent is the root.
 *
 * The app spawns this process and claims the lock with its pid immediately, so
 * a lock carrying our own pid is ours -- either writer may arrive first. A lock
 * held by a *different* live process is a refusal: rendering anyway would put
 * two renders on one machine and make this job invisible to Cancel.
 */
function takeRenderLock(args: WorkerArgs): 'held' | null {
  const lockPath = path.join(path.dirname(args.projectDir), LOCK_FILENAME);
  const lock: RenderLock = {
    projectId: path.basename(args.projectDir),
    projectDir: args.projectDir,
    mode: args.scene === undefined ? 'full' : 'preview',
    sceneIndex: args.scene ?? null,
    pid: process.pid,
    startedAt: Date.now(),
  };

  const outcome = claimLock(lockPath, lock);
  if (outcome === 'held') {
    return 'held';
  }

  // Released on the way out, and only while the lock is still ours: a newer job
  // may have taken it over in the meantime.
  process.on('exit', () => releaseLockIfOwnedBy(lockPath, process.pid));
  return null;
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  let scenes: Scene[];
  try {
    scenes = loadScenes(args);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_FAILED;
  }

  // Claimed after the pre-flight refusals (a refused render must not touch the
  // lock) and before the browser/bundle work.
  if (takeRenderLock(args) === 'held') {
    // Deliberately no status write: the lock holder may be rendering this very
    // project, and stamping "failed" over its live progress would be worse than
    // saying nothing.
    process.stderr.write(
      `[render] refusing to start: another render is already running (lock ${path.join(
        path.dirname(args.projectDir),
        LOCK_FILENAME,
      )}). Cancel it or wait for it to finish.\n`,
    );
    return EXIT_FAILED;
  }

  const previewing = args.scene !== undefined;
  const totalScenes = previewing ? 1 : scenes.length;
  initStatus(args.statusPath, previewing ? 'preview' : 'full', totalScenes);

  try {
    process.stdout.write(
      `[render] ${previewing ? `scene ${args.scene} preview` : `${scenes.length} scenes`} from ${args.projectDir}\n`,
    );

    await ensureBrowser({ logLevel: 'error' });
    abortIfCancelled('browser start-up');

    process.stdout.write('[render] bundling the composition\n');
    const serveUrl = await bundle(ENTRY_POINT);
    abortIfCancelled('bundling');

    if (previewing) {
      const sceneIndex = args.scene as number;
      // Render to a file of its own, then move it into place. Rendering straight
      // over preview.mp4 would be the file the player is already serving, and
      // rendering over the scene's own clip would destroy a finished full-render
      // clip.
      const clipPath = path.join(args.projectDir, PREVIEW_CLIP_FILENAME);
      const previewPath = path.join(args.projectDir, PREVIEW_FILENAME);
      try {
        await renderScene({
          serveUrl,
          scene: scenes[sceneIndex],
          index: sceneIndex,
          totalScenes: 1,
          completedScenes: 0,
          outputPath: clipPath,
          // A preview is its own job of one scene, so its progress is the
          // scene's own: an index over one total would read 100% immediately.
          jobProgress: (sceneProgress) => sceneProgress,
        });
        fs.renameSync(clipPath, previewPath);
        writeStatus({ renderedScenes: 1 }, true);
      } finally {
        // Whether it was cancelled, failed or already moved into place.
        fs.rmSync(clipPath, { force: true });
      }
      return finish('done', 'Preview ready.');
    }

    const clipsDir = path.join(args.projectDir, CLIPS_DIRNAME);
    fs.mkdirSync(clipsDir, { recursive: true });

    const clipFiles: string[] = [];
    for (let index = 0; index < scenes.length; index++) {
      const clip = path.join(clipsDir, sceneClipName(index));
      await renderScene({
        serveUrl,
        scene: scenes[index],
        index,
        totalScenes: scenes.length,
        completedScenes: index,
        outputPath: clip,
        jobProgress: (sceneProgress) => overallProgress(index, sceneProgress, scenes.length),
      });
      clipFiles.push(clip);
      writeStatus(
        {
          renderedScenes: index + 1,
          progress: overallProgress(index + 1, 0, scenes.length),
        },
        true,
      );
    }

    abortIfCancelled('joining');
    await concatClips(clipFiles, path.join(args.projectDir, OUTPUT_FILENAME));
    return finish('done', 'Render complete.');
  } catch (error) {
    if (error instanceof CancelledError || cancelled) {
      // Finished clips stay on disk: a retry re-renders every scene, so they
      // are a starting point for a person, not for the next run.
      return finish('cancelled', 'Render cancelled.');
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[render] failed: ${message}\n`);
    return finish('failed', message.slice(0, 400));
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof UsageError) {
      process.stderr.write(`${message}\n\n${USAGE}`);
    } else {
      process.stderr.write(`[render] crashed: ${message}\n`);
    }
    process.exit(EXIT_FAILED);
  });
